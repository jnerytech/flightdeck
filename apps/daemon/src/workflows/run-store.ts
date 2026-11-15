import type { Database } from "bun:sqlite";
import type { RunStatus, StepStatus, WorkflowRun } from "@flightdeck/protocol";
import { FlightdeckError } from "../kernel/index.ts";
import * as col from "./domain/row-json.ts";
import { type StepRow, toStep } from "./domain/step-row.ts";
import { now, type RunRow } from "./engine-types.ts";

const ACTIVE: ReadonlySet<RunStatus> = new Set(["queued", "running", "waiting"]);

/**
 * The runs of the workflows as rows (#1589): reading a run, moving its status, naming the reason
 * it ended and telling the watchers after each change. The engine decides when a run moves; the
 * steps and the engine both go through here, so neither reaches into the other's state.
 */
export class RunStore {
  private readonly watchers = new Set<(run: WorkflowRun) => void>();

  /** `quotaWaits`: runs waiting for the plan quota before an agent turn, until when (ms) if known. */
  constructor(
    private readonly db: Database,
    private readonly quotaWaits: Map<string, number | null>,
  ) {}

  /** The reason a run ended, as a key and params the app translates. */
  setReasonKey(runId: string, key: string, params: Record<string, string | number>): void {
    this.db
      .query(
        "UPDATE workflow_runs SET status_reason_key = ?, status_reason_params = ? WHERE id = ?",
      )
      .run(key, JSON.stringify(params), runId);
    this.emit(runId);
  }

  /** Gets every run after each change; returns the function that stops it. */
  watch(listener: (run: WorkflowRun) => void): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  /** Runs still going, for a watcher that just arrived. */
  activeRuns(): WorkflowRun[] {
    return this.db
      .query<{ id: string }, []>(
        "SELECT id FROM workflow_runs WHERE status IN ('queued', 'running', 'waiting') ORDER BY started_at",
      )
      .all()
      .map(({ id }) => this.getRun(id));
  }

  /** Whether the run is still going (queued, running or at a gate). */
  active(runId: string): boolean {
    return ACTIVE.has(this.row(runId).status);
  }

  getRun(id: string): WorkflowRun {
    const row = this.row(id);
    const steps = this.db
      .query<StepRow, [string]>("SELECT * FROM step_runs WHERE run_id = ? ORDER BY rowid")
      .all(id)
      .map(toStep);
    const quotaUntil = this.quotaWaits.get(id);
    return {
      id: row.id,
      cardId: row.card_id,
      workflowName: row.workflow_name,
      workflowHash: row.workflow_hash,
      status: row.status,
      statusReason: row.status_reason,
      reasonKey: row.status_reason_key,
      ...col.shownOf(row),
      startedAt: row.started_at,
      endedAt: row.ended_at,
      steps,
      quotaUntil: quotaUntil ? new Date(quotaUntil).toISOString() : null,
    };
  }

  row(id: string): RunRow {
    const row = this.db.query<RunRow, [string]>("SELECT * FROM workflow_runs WHERE id = ?").get(id);
    if (!row)
      throw new FlightdeckError("not_found", `run ${id} does not exist`, "workflow_run_not_found", {
        id,
      });
    return row;
  }

  stepRow(runId: string, stepId: string, attempt: number): StepRow | null {
    return this.db
      .query<StepRow, [string, string, number]>(
        "SELECT * FROM step_runs WHERE run_id = ? AND step_id = ? AND attempt = ?",
      )
      .get(runId, stepId, attempt);
  }

  endStep(
    runId: string,
    stepId: string,
    attempt: number,
    status: StepStatus,
    output: string | null,
    exitCode: number | null = null,
  ): void {
    this.db
      .query(
        `UPDATE step_runs SET status = ?, output = ?, exit_code = ?, ended_at = ?
         WHERE run_id = ? AND step_id = ? AND attempt = ?`,
      )
      .run(status, output, exitCode, now(), runId, stepId, attempt);
    this.emit(runId);
  }

  setStatus(runId: string, status: RunStatus, why: string | null): void {
    this.db
      .query("UPDATE workflow_runs SET status = ?, status_reason = ? WHERE id = ?")
      .run(status, why, runId);
    this.emit(runId);
  }

  end(runId: string, status: RunStatus, why: string | null): void {
    this.db.query("UPDATE workflow_runs SET ended_at = ? WHERE id = ?").run(now(), runId);
    this.setStatus(runId, status, why);
  }

  /** Sends the run as it is now to every watcher. */
  emit(runId: string): void {
    if (this.watchers.size === 0) return;
    const run = this.getRun(runId);
    for (const watcher of this.watchers) {
      try {
        watcher(run);
      } catch {
        // A broken watcher must not break the run.
      }
    }
  }
}
