import type { Database } from "bun:sqlite";
import type {
  PermissionMode,
  RunStatus,
  SessionEvent,
  SessionStatus,
  StepStatus,
} from "@flightdeck/protocol";
import { inSequence } from "@flightdeck/protocol";
import type { Prepare } from "../personas/index.ts";
import { addTurn, overBudget } from "./budget.ts";
import type { CheckResult, CheckRunner } from "./check-runner.ts";
import {
  type EngineHost,
  now,
  type RunRow,
  reason,
  type StepRow,
  type WorkflowEngineOptions,
} from "./engine-types.ts";
import { CARDS_PER_RUN, parseFindings } from "./findings.ts";
import { type InterpolationContext, interpolate, OUTPUTS_SEPARATOR } from "./interpolate.ts";
import { hashOf } from "./repo.ts";
import * as col from "./row-json.ts";
import {
  type Action,
  type AgentAction,
  checkCommands,
  type InnerAction,
  parseWorkflow,
  type Step,
  type Workflow,
} from "./schema.ts";

/** The run was ended by the board while it waited: nothing more to do. */
class Abandoned extends Error {}

/** Fails the run with a reason the app translates (`status_reason_key` and its params). */
class Refused extends Error {
  constructor(
    readonly reasonKey: string,
    readonly params: Record<string, string>,
    why: string,
  ) {
    super(why);
  }
}

/** Ends the run with a status of its own (not `failed`), such as a rejected gate. */
class Stop extends Error {
  constructor(
    readonly status: RunStatus,
    why: string,
  ) {
    super(why);
  }
}

const STOPPED: ReadonlySet<SessionStatus> = new Set(["error", "ended"]);

/** Before the prompt of an agent step whose turn a restart cut short. */
export const RESUMED_NOTE = "A execução foi interrompida; continue de onde parou.";

/** What the steps need from the engine that owns the runs: its stores, its state, its watchers. */
export interface StepContext {
  db: Database;
  manager: WorkflowEngineOptions["manager"];
  preparePersonas: Prepare;
  host: EngineHost;
  checks: CheckRunner;
  clock: () => number;
  gates: Map<string, () => void>;
  quotaWaits: Map<string, number | null>;
  row(id: string): RunRow;
  stepRow(runId: string, stepId: string, attempt: number): StepRow | null;
  setStatus(runId: string, status: RunStatus, why: string | null): void;
  end(runId: string, status: RunStatus, why: string | null): void;
  setReasonKey(runId: string, key: string, params: Record<string, string | number>): void;
  emit(runId: string): void;
  active(runId: string): boolean;
  trusted(projectId: string, name: string, hash: string): boolean;
  recordHead(runId: string, worktree: string): Promise<void>;
}

/** A run's steps executed in order (#1595: out of the engine): agents, checks, gates, loops. */
export class StepRunner {
  constructor(private readonly ctx: StepContext) {}

  async execute(runId: string, worktree: string): Promise<void> {
    const run = this.ctx.row(runId);
    // Validated when the run was prepared.
    const workflow = parseWorkflow(run.definition).workflow as Workflow;
    const context: InterpolationContext = { inputs: col.inputsOf(run.inputs), steps: {} };
    try {
      await inSequence(workflow.steps, async (step) => {
        context.steps[step.id] = await this.runStep(run, worktree, step, context);
      });
      this.finish(run, "completed", null);
    } catch (error) {
      if (error instanceof Abandoned) return;
      // #1266: where the code was when it failed; a resume needs the branch still there.
      if (!(error instanceof Stop)) await this.ctx.recordHead(run.id, worktree);
      if (error instanceof Stop) this.finish(run, error.status, error.message);
      else if (error instanceof Refused) {
        this.finish(run, "failed", error.message);
        this.ctx.setReasonKey(run.id, error.reasonKey, error.params);
      } else this.finish(run, "failed", reason(error));
    }
  }

  private async runStep(
    run: RunRow,
    worktree: string,
    step: Step,
    context: InterpolationContext,
  ): Promise<{ output?: string; outputs?: string[] }> {
    // Replayed after a restart: a finished step gives back what it stored.
    const finished = this.ctx.stepRow(run.id, step.id, 1);
    if (finished?.status === "completed") {
      if (!("parallel" in step)) return { output: finished.output ?? "" };
      const items = step.parallel.map((_, i) => this.ctx.stepRow(run.id, `${step.id}.${i}`, 1));
      return { outputs: items.map((item) => item?.output ?? "") };
    }
    if ("gate" in step) return { output: await this.gateStep(run, step.id, step.gate, context) };
    if ("loop" in step) {
      return { output: await this.loopStep(run, worktree, step.id, step.loop, context) };
    }
    if ("pr" in step) return { output: await this.prStep(run, step.id) };
    if ("cards" in step) return { output: this.cardsStep(run, step.id, step.cards.from, context) };
    if ("parallel" in step) {
      return { outputs: await this.parallelStep(run, worktree, step.id, step.parallel, context) };
    }
    const action = step as InnerAction;
    return { output: await this.innerStep(run, worktree, step.id, 1, action, context) };
  }

  /**
   * Runs the items (`<id>.<index>`) with the card's slot plus the host slots free right now, so
   * `maxParallelRuns` holds; with none free they go one after another. Outputs keep the declared
   * order; a failed item fails the step once every item has finished.
   */
  private async parallelStep(
    run: RunRow,
    worktree: string,
    stepId: string,
    items: InnerAction[],
    context: InterpolationContext,
  ): Promise<string[]> {
    this.ctx.db
      .query(
        `INSERT OR IGNORE INTO step_runs (run_id, step_id, attempt, type, status, started_at)
         VALUES (?, ?, 1, 'parallel', 'running', ?)`,
      )
      .run(run.id, stepId, now());
    this.ctx.emit(run.id);
    const extra = this.ctx.host.takeSlots(run.card_id, items.length - 1);
    const outputs: string[] = [];
    /** By item index: the first declared failure is the one reported. */
    const failures: Array<{ error: unknown }> = [];
    let next = 0;
    const worker = async () => {
      for (let index = next++; index < items.length; index = next++) {
        const item = items[index] as InnerAction;
        try {
          outputs[index] =
            await /* NOSONAR: a worker of the pool takes the next item only when its previous one is done */ this.innerStep(
              run,
              worktree,
              `${stepId}.${index}`,
              1,
              item,
              context,
            );
        } catch (error) {
          failures[index] = { error };
        }
      }
    };
    await Promise.all([worker(), ...extra.map(() => worker())]);
    for (const key of extra) this.ctx.host.release(key);
    const failed = failures.find((failure) => failure !== undefined);
    if (failed) {
      this.endStep(run.id, stepId, 1, "failed", null);
      throw failed.error;
    }
    this.endStep(run.id, stepId, 1, "completed", outputs.join(OUTPUTS_SEPARATOR));
    return outputs;
  }

  /** Push and PR through the project's provider; the card goes to Em revisão. */
  private async prStep(run: RunRow, stepId: string): Promise<string> {
    this.ctx.db
      .query(
        `INSERT OR IGNORE INTO step_runs (run_id, step_id, attempt, type, status, started_at)
         VALUES (?, ?, 1, 'pr', 'running', ?)`,
      )
      .run(run.id, stepId, now());
    this.ctx.emit(run.id);
    try {
      const url = await this.ctx.host.createPr(run.card_id);
      this.endStep(run.id, stepId, 1, "completed", url);
      return url;
    } catch (error) {
      this.endStep(run.id, stepId, 1, "failed", null);
      throw new Error(`etapa ${stepId} falhou: ${reason(error)}`);
    }
  }

  /** Issue #79: raises the findings in the reply of an earlier agent step as Backlog cards. */
  private cardsStep(
    run: RunRow,
    stepId: string,
    from: string,
    context: InterpolationContext,
  ): string {
    this.ctx.db
      .query(
        `INSERT OR IGNORE INTO step_runs (run_id, step_id, attempt, type, status, started_at)
         VALUES (?, ?, 1, 'cards', 'running', ?)`,
      )
      .run(run.id, stepId, now());
    this.ctx.emit(run.id);
    // The reply is untrusted text: any shape problem raises nothing and the run says why.
    const parsed = parseFindings(context.steps[from]?.output ?? "");
    if (!parsed.ok) {
      this.endStep(run.id, stepId, 1, "failed", null);
      const params: Record<string, string> = { step: from };
      if (parsed.reason === "findings_invalid") params.where = parsed.where;
      throw new Refused(
        parsed.reason,
        params,
        parsed.reason === "findings_missing"
          ? `step ${stepId}: the reply of ${from} has no json block of findings`
          : `step ${stepId}: the reply of ${from} is not a valid list of findings (${params.where})`,
      );
    }
    const raised = this.ctx.host.raiseCards(run.card_id, parsed.findings, {
      workflow: run.workflow_name,
      runId: run.id,
    });
    const count = raised.created.length;
    const summary = `Raised ${count} ${count === 1 ? "card" : "cards"}; ${raised.duplicates} already covered; ${raised.overCap} over the cap of ${CARDS_PER_RUN}.`;
    this.endStep(run.id, stepId, 1, "completed", summary);
    return summary;
  }

  /** An agent or a check (on its own, or inside a loop or a parallel); a failed check fails. */
  private async innerStep(
    run: RunRow,
    worktree: string,
    stepId: string,
    attempt: number,
    action: InnerAction,
    context: InterpolationContext,
  ): Promise<string> {
    if ("check" in action) {
      const { exitCode, output } = await this.checkStep(
        run,
        worktree,
        stepId,
        attempt,
        action.check,
      );
      if (exitCode !== 0)
        throw new Error(`etapa ${stepId} falhou: check saiu com código ${exitCode}`);
      return output;
    }
    return this.agentStep(run, worktree, stepId, attempt, action.agent, context);
  }

  /**
   * Checks `until`; while it fails, runs `do` (iteration n is attempt n of `<id>.check` and
   * `<id>.do`) with the last check in `{{loop.lastCheck.*}}`. After `max` runs of `do` with the
   * check still failing, the run pauses. The loop's output is the passing check's.
   */
  private async loopStep(
    run: RunRow,
    worktree: string,
    stepId: string,
    loop: Extract<Action, { loop: unknown }>["loop"],
    context: InterpolationContext,
  ): Promise<string> {
    this.ctx.db
      .query(
        `INSERT OR IGNORE INTO step_runs (run_id, step_id, attempt, type, status, started_at)
         VALUES (?, ?, 1, 'loop', 'running', ?)`,
      )
      .run(run.id, stepId, now());
    this.ctx.emit(run.id);
    try {
      for (let attempt = 1; ; attempt++) {
        const check =
          await /* NOSONAR: retry: an attempt starts only after the one before has not worked */ this.checkStep(
            run,
            worktree,
            `${stepId}.check`,
            attempt,
            loop.until.check,
          );
        if (check.exitCode === 0) {
          this.endStep(run.id, stepId, 1, "completed", check.output);
          return check.output;
        }
        if (attempt > loop.max) {
          const why = `loop ${stepId}: o check ainda falha depois de ${loop.max} repetições`;
          throw new Stop("paused", why);
        }
        const inner = { ...context, loop: { lastCheck: check } };
        await this.innerStep(run, worktree, `${stepId}.do`, attempt, loop.do, inner); // NOSONAR: a worker of the pool takes the next item only when its previous one is done
      }
    } catch (error) {
      this.endStep(run.id, stepId, 1, "failed", null);
      throw error;
    }
  }

  /**
   * Waits for your answer: the card goes to Esperando você and its slot is freed meanwhile.
   * Approved, the run takes a slot again and goes on with the note as the gate's output.
   */
  private async gateStep(
    run: RunRow,
    stepId: string,
    gate: { message: string; show?: string },
    context: InterpolationContext,
  ): Promise<string> {
    let answer = this.ctx.stepRow(run.id, stepId, 1);
    if (!answer) {
      const show = gate.show === undefined ? null : interpolate(gate.show, context);
      this.ctx.db
        .query(
          `INSERT INTO step_runs (run_id, step_id, attempt, type, status, output, message, started_at)
           VALUES (?, ?, 1, 'gate', 'waiting', ?, ?, ?)`,
        )
        .run(run.id, stepId, show, interpolate(gate.message, context), now());
      this.ctx.emit(run.id);
      this.ctx.setStatus(run.id, "waiting", null);
      this.ctx.host.place(run.card_id, { type: "workflow", state: "waiting" });
      this.ctx.host.release(run.card_id);
    }
    // Still open (just now, or since before a restart): wait for the answer.
    if (answer?.status !== "approved") {
      await new Promise<void>((resolve) => this.ctx.gates.set(`${run.id}/${stepId}/1`, resolve));
    }
    answer = this.ctx.stepRow(run.id, stepId, 1) as StepRow;
    if (answer.status === "rejected") {
      const note = answer.note ? `: ${answer.note}` : "";
      throw new Stop("rejected", `gate ${stepId} recusado${note}`);
    }
    // Approved while waiting: take a slot again (a run past the gate already holds one).
    if (this.ctx.row(run.id).status === "waiting") {
      await this.ctx.host.acquire(run.card_id);
      this.ctx.setStatus(run.id, "running", null);
      this.ctx.host.place(run.card_id, { type: "workflow", state: "running" });
    }
    return answer.note ?? "";
  }

  /** Runs a check of the trusted workflow; any other command never reaches the executor. */
  private async checkStep(
    run: RunRow,
    worktree: string,
    stepId: string,
    attempt: number,
    command: string,
  ): Promise<CheckResult> {
    // A check that finished before a restart keeps its result; one cut short runs again.
    const done = this.ctx.stepRow(run.id, stepId, attempt);
    if (done?.ended_at) return { exitCode: done.exit_code ?? 1, output: done.output ?? "" };
    this.ctx.db
      .query(
        `INSERT INTO step_runs (run_id, step_id, attempt, type, status, started_at)
         VALUES (?, ?, ?, 'check', 'running', ?)
         ON CONFLICT (run_id, step_id, attempt) DO UPDATE SET started_at = excluded.started_at`,
      )
      .run(run.id, stepId, attempt, now());
    this.ctx.emit(run.id);
    try {
      if (!this.allowed(run.id, command)) {
        throw new Error(`comando fora do workflow confiado: ${command}`);
      }
      const result = await this.ctx.checks.run(command, worktree);
      const status = result.exitCode === 0 ? "completed" : "failed";
      this.endStep(run.id, stepId, attempt, status, result.output, result.exitCode);
      return result;
    } catch (error) {
      this.endStep(run.id, stepId, attempt, "failed", null);
      throw new Error(`etapa ${stepId} falhou: ${reason(error)}`);
    }
  }

  /** `command` is literally a check of the run's workflow, whose content is still trusted. */
  private allowed(runId: string, command: string): boolean {
    const run = this.ctx.row(runId);
    const { projectId } = this.ctx.host.card(run.card_id);
    const intact =
      hashOf(run.definition) === run.workflow_hash &&
      this.ctx.trusted(projectId, run.workflow_name, run.workflow_hash);
    const workflow = intact ? parseWorkflow(run.definition).workflow : null;
    return workflow !== null && checkCommands(workflow).includes(command);
  }

  private async agentStep(
    run: RunRow,
    worktree: string,
    stepId: string,
    attempt: number,
    action: AgentAction,
    context: InterpolationContext,
  ): Promise<string> {
    const cut = this.ctx.stepRow(run.id, stepId, attempt);
    if (cut?.status === "completed") return cut.output ?? "";
    // Checked before every turn: a run over its budget pauses instead of spending more.
    const over = overBudget(col.budgetOf(run.budget), col.spendingOf(this.ctx.row(run.id).usage));
    if (over) throw new Stop("paused", over);
    // At the same point: over the plan quota, the turn waits for the window to reset.
    const quota = this.ctx.host.waitQuota();
    if (quota) {
      this.ctx.quotaWaits.set(run.id, quota.until);
      this.ctx.setStatus(run.id, "running", "aguardando cota");
      await quota.done;
      this.ctx.quotaWaits.delete(run.id);
      if (!this.ctx.active(run.id)) throw new Abandoned();
      this.ctx.setStatus(run.id, "running", null);
    }
    const prompt = interpolate(action.prompt, context);
    let target = action.continue
      ? (this.ctx.stepRow(run.id, action.continue, 1)?.session_id ?? null)
      : null;
    if (cut) {
      // The turn was cut short by a restart: same session, the prompt again with a note.
      target = cut.session_id;
    } else {
      this.ctx.db
        .query(
          `INSERT INTO step_runs (run_id, step_id, attempt, type, status, session_id, started_at)
           VALUES (?, ?, ?, 'agent', 'running', ?, ?)`,
        )
        .run(run.id, stepId, attempt, target, now());
      this.ctx.emit(run.id);
    }
    const text = cut ? `${RESUMED_NOTE}\n\n${prompt}` : prompt;
    try {
      const output = await this.turn(run, worktree, stepId, attempt, target, text, action);
      this.endStep(run.id, stepId, attempt, "completed", output);
      return output;
    } catch (error) {
      this.endStep(run.id, stepId, attempt, "failed", null);
      throw new Error(`etapa ${stepId} falhou: ${reason(error)}`);
    }
  }

  /** One turn: a new session in the worktree, or a message to the `continue` step's session. */
  private async turn(
    run: RunRow,
    worktree: string,
    stepId: string,
    attempt: number,
    target: string | null,
    prompt: string,
    action: { permissionMode?: PermissionMode; persona?: string },
  ): Promise<string> {
    const started = this.ctx.clock();
    if (target) {
      // Left `error` by a restart (or ended): reopened with the stored Claude session.
      if (STOPPED.has(this.ctx.manager.get(target).status)) await this.ctx.manager.resume(target);
      const since = this.ctx.manager.get(target).lastSeq;
      const done = this.awaitTurn(run, { stepId, attempt }, target, since, started);
      this.ctx.manager.send(target, prompt);
      return done;
    }
    const { title } = this.ctx.host.card(run.card_id);
    const persona = action.persona ? { id: action.persona } : undefined;
    const prepared = await this.ctx.preparePersonas(persona, worktree);
    const { sessionId } = await this.ctx.manager.create(
      {
        cwd: worktree,
        prompt,
        name: `${title} · ${stepId}`,
        ...(action.permissionMode ? { permissionMode: action.permissionMode } : {}),
        ...(persona ? { persona } : {}),
      },
      { prepared },
    );
    this.ctx.db
      .query("UPDATE step_runs SET session_id = ? WHERE run_id = ? AND step_id = ? AND attempt = ?")
      .run(sessionId, run.id, stepId, attempt);
    this.ctx.emit(run.id);
    return this.awaitTurn(run, { stepId, attempt }, sessionId, 0, started);
  }

  /**
   * Resolves with the assistant text of the next turn of `sessionId` (events after `since`):
   * the text blocks of every message of the turn, in order. Session statuses move the card;
   * the turn goes into the run's spending.
   */
  private awaitTurn(
    run: RunRow,
    step: { stepId: string; attempt: number },
    sessionId: string,
    since: number,
    started: number,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const texts: string[] = [];
      let settled = false;
      const settle = (done: () => void) => {
        settled = true;
        sub.unsubscribe();
        done();
      };
      const onEvent = (event: SessionEvent) => {
        if (settled) return;
        if (event.type === "session.status") {
          this.ctx.host.place(run.card_id, { type: "session", status: event.status });
        } else if (event.type === "message.assistant") {
          for (const block of event.blocks) if (block.type === "text") texts.push(block.text);
        } else if (event.type === "turn.result") {
          this.spend(run.id, step, {
            sessionId,
            costUsd: event.costUsd,
            minutes: (this.ctx.clock() - started) / 60_000,
          });
          settle(() =>
            event.isError
              ? reject(new Error(`turno terminou com erro (${event.subtype})`))
              : resolve(texts.join("\n\n")),
          );
        } else if (event.type === "session.error") {
          settle(() => reject(new Error(event.message)));
        }
      };
      const sub = this.ctx.manager.subscribe(sessionId, since, (envelope) =>
        onEvent(envelope.event),
      );
      for (const envelope of sub.replay) onEvent(envelope.event);
    });
  }

  /** A turn goes into the run's spending and into its step's share. */
  private spend(
    runId: string,
    step: { stepId: string; attempt: number },
    turn: Parameters<typeof addTurn>[1],
  ): void {
    const before = col.spendingOf(this.ctx.row(runId).usage);
    const spending = addTurn(before, turn);
    this.ctx.db
      .query("UPDATE workflow_runs SET usage = ? WHERE id = ?")
      .run(JSON.stringify(spending), runId);
    const row = this.ctx.stepRow(runId, step.stepId, step.attempt) as StepRow;
    const share = col.stepUsageOf(row.usage) ?? { turns: 0, minutes: 0, costUsd: 0 };
    const usage = {
      turns: share.turns + 1,
      minutes: share.minutes + turn.minutes,
      costUsd: share.costUsd + (spending.costUsd - before.costUsd),
    };
    this.ctx.db
      .query("UPDATE step_runs SET usage = ? WHERE run_id = ? AND step_id = ? AND attempt = ?")
      .run(JSON.stringify(usage), runId, step.stepId, step.attempt);
    this.ctx.emit(runId);
  }

  private endStep(
    runId: string,
    stepId: string,
    attempt: number,
    status: StepStatus,
    output: string | null,
    exitCode: number | null = null,
  ): void {
    this.ctx.db
      .query(
        `UPDATE step_runs SET status = ?, output = ?, exit_code = ?, ended_at = ?
         WHERE run_id = ? AND step_id = ? AND attempt = ?`,
      )
      .run(status, output, exitCode, now(), runId, stepId, attempt);
    this.ctx.emit(runId);
  }

  /** The run is over: the card goes to Em revisão (completed) or Esperando você. */
  private finish(run: RunRow, status: RunStatus, why: string | null): void {
    this.ctx.end(run.id, status, why);
    this.ctx.host.place(run.card_id, {
      type: "workflow",
      state: status === "completed" ? "done" : "waiting",
    });
    this.ctx.host.release(run.card_id);
  }
}
