import type { RunStatus } from "@flightdeck/protocol";
import { inSequence } from "@flightdeck/protocol";
import { type AgentTurnDeps, AgentTurns } from "./agent-turn.ts";
import type { CheckResult, CheckRunner } from "./check-runner.ts";
import { CARDS_PER_RUN, parseFindings } from "./domain/findings.ts";
import { type InterpolationContext, interpolate, OUTPUTS_SEPARATOR } from "./domain/interpolate.ts";
import * as col from "./domain/row-json.ts";
import {
  type Action,
  checkCommands,
  type InnerAction,
  parseWorkflow,
  type Step,
  type Workflow,
} from "./domain/schema.ts";
import type { StepRow } from "./domain/step-row.ts";
import { Abandoned, now, Refused, type RunRow, reason, Stop } from "./engine-types.ts";
import { hashOf } from "./repo.ts";

/** What the steps need from the engine that owns the runs: its stores, its state, its watchers. */
export interface StepContext extends AgentTurnDeps {
  checks: CheckRunner;
  gates: Map<string, () => void>;
  trusted(projectId: string, name: string, hash: string): boolean;
  recordHead(runId: string, worktree: string): Promise<void>;
}

/** A run's steps executed in order (#1595: out of the engine): agents, checks, gates, loops. */
export class StepRunner {
  private readonly agent: AgentTurns;

  constructor(private readonly ctx: StepContext) {
    this.agent = new AgentTurns(ctx);
  }

  async execute(runId: string, worktree: string): Promise<void> {
    const run = this.ctx.store.row(runId);
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
        this.ctx.store.setReasonKey(run.id, error.reasonKey, error.params);
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
    const finished = this.ctx.store.stepRow(run.id, step.id, 1);
    if (finished?.status === "completed") {
      if (!("parallel" in step)) return { output: finished.output ?? "" };
      const items = step.parallel.map((_, i) =>
        this.ctx.store.stepRow(run.id, `${step.id}.${i}`, 1),
      );
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
    this.ctx.store.emit(run.id);
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
      this.ctx.store.endStep(run.id, stepId, 1, "failed", null);
      throw failed.error;
    }
    this.ctx.store.endStep(run.id, stepId, 1, "completed", outputs.join(OUTPUTS_SEPARATOR));
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
    this.ctx.store.emit(run.id);
    try {
      const url = await this.ctx.host.createPr(run.card_id);
      this.ctx.store.endStep(run.id, stepId, 1, "completed", url);
      return url;
    } catch (error) {
      this.ctx.store.endStep(run.id, stepId, 1, "failed", null);
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
    this.ctx.store.emit(run.id);
    // The reply is untrusted text: any shape problem raises nothing and the run says why.
    const parsed = parseFindings(context.steps[from]?.output ?? "");
    if (!parsed.ok) {
      this.ctx.store.endStep(run.id, stepId, 1, "failed", null);
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
    this.ctx.store.endStep(run.id, stepId, 1, "completed", summary);
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
    return this.agent.run(run, worktree, stepId, attempt, action.agent, context);
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
    this.ctx.store.emit(run.id);
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
          this.ctx.store.endStep(run.id, stepId, 1, "completed", check.output);
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
      this.ctx.store.endStep(run.id, stepId, 1, "failed", null);
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
    let answer = this.ctx.store.stepRow(run.id, stepId, 1);
    if (!answer) {
      const show = gate.show === undefined ? null : interpolate(gate.show, context);
      this.ctx.db
        .query(
          `INSERT INTO step_runs (run_id, step_id, attempt, type, status, output, message, started_at)
           VALUES (?, ?, 1, 'gate', 'waiting', ?, ?, ?)`,
        )
        .run(run.id, stepId, show, interpolate(gate.message, context), now());
      this.ctx.store.emit(run.id);
      this.ctx.store.setStatus(run.id, "waiting", null);
      this.ctx.host.place(run.card_id, { type: "workflow", state: "waiting" });
      this.ctx.host.release(run.card_id);
    }
    // Still open (just now, or since before a restart): wait for the answer.
    if (answer?.status !== "approved") {
      await new Promise<void>((resolve) => this.ctx.gates.set(`${run.id}/${stepId}/1`, resolve));
    }
    answer = this.ctx.store.stepRow(run.id, stepId, 1) as StepRow;
    if (answer.status === "rejected") {
      const note = answer.note ? `: ${answer.note}` : "";
      throw new Stop("rejected", `gate ${stepId} recusado${note}`);
    }
    // Approved while waiting: take a slot again (a run past the gate already holds one).
    if (this.ctx.store.row(run.id).status === "waiting") {
      await this.ctx.host.acquire(run.card_id);
      this.ctx.store.setStatus(run.id, "running", null);
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
    const done = this.ctx.store.stepRow(run.id, stepId, attempt);
    if (done?.ended_at) return { exitCode: done.exit_code ?? 1, output: done.output ?? "" };
    this.ctx.db
      .query(
        `INSERT INTO step_runs (run_id, step_id, attempt, type, status, started_at)
         VALUES (?, ?, ?, 'check', 'running', ?)
         ON CONFLICT (run_id, step_id, attempt) DO UPDATE SET started_at = excluded.started_at`,
      )
      .run(run.id, stepId, attempt, now());
    this.ctx.store.emit(run.id);
    try {
      if (!this.allowed(run.id, command)) {
        throw new Error(`comando fora do workflow confiado: ${command}`);
      }
      const result = await this.ctx.checks.run(command, worktree);
      const status = result.exitCode === 0 ? "completed" : "failed";
      this.ctx.store.endStep(run.id, stepId, attempt, status, result.output, result.exitCode);
      return result;
    } catch (error) {
      this.ctx.store.endStep(run.id, stepId, attempt, "failed", null);
      throw new Error(`etapa ${stepId} falhou: ${reason(error)}`);
    }
  }

  /** `command` is literally a check of the run's workflow, whose content is still trusted. */
  private allowed(runId: string, command: string): boolean {
    const run = this.ctx.store.row(runId);
    const { projectId } = this.ctx.host.card(run.card_id);
    const intact =
      hashOf(run.definition) === run.workflow_hash &&
      this.ctx.trusted(projectId, run.workflow_name, run.workflow_hash);
    const workflow = intact ? parseWorkflow(run.definition).workflow : null;
    return workflow !== null && checkCommands(workflow).includes(command);
  }

  /** The run is over: the card goes to Em revisão (completed) or Esperando você. */
  private finish(run: RunRow, status: RunStatus, why: string | null): void {
    this.ctx.store.end(run.id, status, why);
    this.ctx.host.place(run.card_id, {
      type: "workflow",
      state: status === "completed" ? "done" : "waiting",
    });
    this.ctx.host.release(run.card_id);
  }
}
