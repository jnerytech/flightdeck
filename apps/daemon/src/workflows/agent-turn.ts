import type { Database } from "bun:sqlite";
import type { PermissionMode, SessionEvent, SessionStatus } from "@flightdeck/protocol";
import type { Prepare } from "../personas/index.ts";
import { addTurn, overBudget } from "./domain/budget.ts";
import { type InterpolationContext, interpolate } from "./domain/interpolate.ts";
import * as col from "./domain/row-json.ts";
import type { AgentAction } from "./domain/schema.ts";
import type { StepRow } from "./domain/step-row.ts";
import { stepShare, turnReader } from "./domain/turn-events.ts";
import {
  Abandoned,
  type EngineHost,
  now,
  type RunRow,
  reason,
  Stop,
  type WorkflowEngineOptions,
} from "./engine-types.ts";
import type { RunStore } from "./run-store.ts";

const STOPPED: ReadonlySet<SessionStatus> = new Set(["error", "ended"]);

/** Before the prompt of an agent step whose turn a restart cut short. */
const RESUMED_NOTE = "A execução foi interrompida; continue de onde parou.";

/** What an agent turn needs from the engine that owns the runs: its stores, its sessions, its host. */
export interface AgentTurnDeps {
  db: Database;
  manager: WorkflowEngineOptions["manager"];
  preparePersonas: Prepare;
  host: EngineHost;
  clock: () => number;
  quotaWaits: Map<string, number | null>;
  /** The runs as rows: read, moved and announced to the watchers. */
  store: RunStore;
}

/**
 * The agent steps of a run (#1589: out of the step runner): the budget and quota checks before a
 * turn, the session the turn runs in (a new one, or the `continue` step's) and the turn's spending.
 */
export class AgentTurns {
  constructor(private readonly ctx: AgentTurnDeps) {}

  /** One agent step: its turn, the step row ended as completed or failed, and the assistant text. */
  async run(
    run: RunRow,
    worktree: string,
    stepId: string,
    attempt: number,
    action: AgentAction,
    context: InterpolationContext,
  ): Promise<string> {
    const cut = this.ctx.store.stepRow(run.id, stepId, attempt);
    if (cut?.status === "completed") return cut.output ?? "";
    // Checked before every turn: a run over its budget pauses instead of spending more.
    const over = overBudget(
      col.budgetOf(run.budget),
      col.spendingOf(this.ctx.store.row(run.id).usage),
    );
    if (over) throw new Stop("paused", over);
    // At the same point: over the plan quota, the turn waits for the window to reset.
    const quota = this.ctx.host.waitQuota();
    if (quota) {
      this.ctx.quotaWaits.set(run.id, quota.until);
      this.ctx.store.setStatus(run.id, "running", "aguardando cota");
      await quota.done;
      this.ctx.quotaWaits.delete(run.id);
      if (!this.ctx.store.active(run.id)) throw new Abandoned();
      this.ctx.store.setStatus(run.id, "running", null);
    }
    const prompt = interpolate(action.prompt, context);
    let target = action.continue
      ? (this.ctx.store.stepRow(run.id, action.continue, 1)?.session_id ?? null)
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
      this.ctx.store.emit(run.id);
    }
    const text = cut ? `${RESUMED_NOTE}\n\n${prompt}` : prompt;
    try {
      const output = await this.turn(run, worktree, stepId, attempt, target, text, action);
      this.ctx.store.endStep(run.id, stepId, attempt, "completed", output);
      return output;
    } catch (error) {
      this.ctx.store.endStep(run.id, stepId, attempt, "failed", null);
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
    this.ctx.store.emit(run.id);
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
      const read = turnReader();
      let settled = false;
      const settle = (done: () => void) => {
        settled = true;
        sub.unsubscribe();
        done();
      };
      const onEvent = (event: SessionEvent) => {
        if (settled) return;
        const reaction = read(event);
        if (reaction?.type === "status") {
          this.ctx.host.place(run.card_id, { type: "session", status: reaction.status });
        } else if (reaction?.type === "turn") {
          this.spend(run.id, step, {
            sessionId,
            costUsd: reaction.costUsd,
            minutes: (this.ctx.clock() - started) / 60_000,
          });
          settle(() =>
            reaction.failure ? reject(new Error(reaction.failure)) : resolve(reaction.text),
          );
        } else if (reaction?.type === "failed") {
          settle(() => reject(new Error(reaction.message)));
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
    const before = col.spendingOf(this.ctx.store.row(runId).usage);
    const spending = addTurn(before, turn);
    this.ctx.db
      .query("UPDATE workflow_runs SET usage = ? WHERE id = ?")
      .run(JSON.stringify(spending), runId);
    const row = this.ctx.store.stepRow(runId, step.stepId, step.attempt) as StepRow;
    const usage = stepShare(
      col.stepUsageOf(row.usage),
      turn.minutes,
      spending.costUsd - before.costUsd,
    );
    this.ctx.db
      .query("UPDATE step_runs SET usage = ? WHERE run_id = ? AND step_id = ? AND attempt = ?")
      .run(JSON.stringify(usage), runId, step.stepId, step.attempt);
    this.ctx.store.emit(runId);
  }
}
