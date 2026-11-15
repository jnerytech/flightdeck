import type { Database } from "bun:sqlite";
import type { Card, Project, RunResumeCheck } from "@flightdeck/protocol";
import { git } from "../git/index.ts";
import { FlightdeckError } from "../kernel/index.ts";
import {
  childrenOf,
  type ResumeRefusal,
  resumeRefusal,
  sourceRefusal,
  staleRows,
} from "./domain/resume-check.ts";
import { parseWorkflow, type Workflow } from "./domain/schema.ts";
import { type EngineHost, now, type RunRow, reason } from "./engine-types.ts";
import type { WorkflowRegistry } from "./registry.ts";
import { hashOf } from "./repo.ts";
import type { RunStore } from "./run-store.ts";

/** The commit a worktree's HEAD is at, from git; null when it cannot say. */
export async function gitHead(worktree: string): Promise<string | null> {
  const found = await git(worktree, "rev-parse", "--verify", "--quiet", "HEAD");
  return found.code === 0 ? found.stdout.trim() : null;
}

/** What the resumes of runs (#1266) use from the engine. */
export interface RunResumesDeps {
  db: Database;
  host: EngineHost;
  store: RunStore;
  registry: WorkflowRegistry;
  headOf: (worktree: string) => Promise<string | null>;
  /** The card's worktree is ready and its slot taken: the run executes its steps. */
  begin: (runId: string, worktree: string) => void;
  cardOrNull: (cardId: string) => Card | null;
}

/**
 * Resume of a failed run (#1266): the check, the write that clears what failed, the wait for a
 * slot and the recovery of resumes that were waiting when the daemon stopped. It decides whether
 * a run starts again, so it never runs one the registry no longer trusts.
 */
export class RunResumes {
  /** #1266: the runs being resumed right now: a second resume of one is refused. */
  private readonly resuming = new Set<string>();

  constructor(private readonly deps: RunResumesDeps) {}

  /** Back from a restart: a resume that was waiting for its slot waits again, with the HEAD it was given. */
  recoverQueued(): void {
    const { db, host, store, registry } = this.deps;
    const resumed = db
      .query<RunRow & { head: string | null }, []>(
        `SELECT r.*, (SELECT head FROM run_resumes WHERE run_id = r.id ORDER BY n DESC LIMIT 1) AS head
         FROM workflow_runs r WHERE r.status = 'queued'
         AND EXISTS (SELECT 1 FROM run_resumes WHERE run_id = r.id)`,
      )
      .all();
    for (const run of resumed) {
      // What a resume would refuse is never run: its card must still be the run's, its stored
      // definition its hash, the workflow still trusted, and a HEAD recorded. Any of these
      // failing fails that run only, never the daemon's start.
      const card = this.deps.cardOrNull(run.card_id);
      const why = (() => {
        if (!card?.worktreePath || card.discarded || card.workflowRunId !== run.id) {
          return "run_resume_card";
        }
        if (hashOf(run.definition) !== run.workflow_hash) return "run_resume_workflow_changed";
        if (!registry.trusted(card.projectId, run.workflow_name, run.workflow_hash)) {
          return "workflow_not_trusted";
        }
        return run.head ? null : "run_resume_no_head";
      })();
      if (why || !card?.worktreePath || !run.head) {
        // The HEAD stays: asked again, the run gives the same reason, not that it has none.
        this.restoreHead(run.id, run.head);
        store.end(run.id, "failed", "the resume cannot go on after the restart");
        const key = why ?? "run_resume_card";
        store.setReasonKey(
          run.id,
          key,
          key === "run_resume_workflow_changed" || key === "workflow_not_trusted"
            ? { name: run.workflow_name }
            : {},
        );
        // Only a card that is still this run's goes to waiting: one that moved on to another
        // run stays where that run put it.
        if (card?.workflowRunId === run.id) {
          host.place(run.card_id, { type: "workflow", state: "waiting" });
        }
        continue;
      }
      this.resuming.add(run.id);
      void this.afterSlot(run.id, run.card_id, card.worktreePath, run.head);
    }
  }

  async recordHead(runId: string, worktree: string): Promise<void> {
    const head = await this.deps.headOf(worktree).catch(() => null);
    this.deps.db.query("UPDATE workflow_runs SET head_at_end = ? WHERE id = ?").run(head, runId);
  }

  /**
   * Whether a failed run can resume, and from which step: the first one not completed. Refused
   * when it did not fail, its card cannot take it, it has no recorded HEAD, the workflow on the
   * base branch changed or is no longer trusted, or the card's branch moved since it ended.
   */
  async check(runId: string, project: Project): Promise<RunResumeCheck> {
    const { host, store, registry } = this.deps;
    const run = store.row(runId);
    const workflow = parseWorkflow(run.definition).workflow as Workflow;
    const from =
      workflow.steps.find((step) => store.stepRow(run.id, step.id, 1)?.status !== "completed")
        ?.id ?? "";
    const no = ({ reason, params }: ResumeRefusal): RunResumeCheck => ({
      from,
      ok: false,
      reason,
      ...(params ? { params } : {}),
    });
    let card: Card | null;
    try {
      card = host.card(run.card_id);
    } catch {
      card = null;
    }
    const early = resumeRefusal({
      name: run.workflow_name,
      failedAndFree: run.status === "failed" && !this.resuming.has(run.id),
      definitionIntact: hashOf(run.definition) === run.workflow_hash,
      cardTakesIt:
        card !== null && !card.discarded && !!card.worktreePath && card.workflowRunId === run.id,
      hasHead: !!run.head_at_end,
    });
    if (early) return no(early);
    const source = await registry.source(project, run.workflow_name).catch(() => null);
    const late = sourceRefusal(run.workflow_name, run.workflow_hash, source?.hash, () =>
      registry.trusted(project.id, run.workflow_name, run.workflow_hash),
    );
    if (late) return no(late);
    // `early` said the card has a worktree.
    const worktree = card?.worktreePath ?? "";
    if ((await this.deps.headOf(worktree).catch(() => null)) !== run.head_at_end) {
      return no({ reason: "run_resume_branch_moved" });
    }
    return { from, ok: true };
  }

  /**
   * Resumes a failed run in place: the check again, the resume recorded with what failed, the
   * steps not completed cleared (the failed one runs from scratch), then the run waits for a slot
   * and executes; the completed steps give back what they stored.
   */
  async resume(runId: string, project: Project): Promise<RunResumeCheck> {
    const { host, store } = this.deps;
    const check = await this.check(runId, project);
    if (!check.ok) {
      throw new FlightdeckError(
        "invalid_state",
        `run ${runId} cannot resume: ${check.reason}`,
        check.reason,
        check.params,
      );
    }
    // Nothing awaited from here to the writes: the run and its card are checked again as they are
    // now, so a second resume or a start that came in meanwhile cannot run beside this one.
    const run = store.row(runId);
    const card = host.card(run.card_id);
    if (run.status !== "failed" || this.resuming.has(run.id)) {
      throw new FlightdeckError(
        "invalid_state",
        `run ${runId} is no longer failed`,
        "run_resume_not_failed",
      );
    }
    if (card.discarded || card.queued || !card.worktreePath || card.workflowRunId !== run.id) {
      throw new FlightdeckError(
        "invalid_state",
        "the run's card cannot take it",
        "run_resume_card",
      );
    }
    const worktree = card.worktreePath;
    const head = run.head_at_end;
    this.resuming.add(run.id);
    try {
      this.write(run, check.from, head);
    } catch (error) {
      // Nothing was written: the run stays failed, and resumable.
      this.resuming.delete(run.id);
      throw error;
    }
    store.emit(run.id);
    void this.afterSlot(run.id, run.card_id, worktree, head);
    return check;
  }

  /** The resume recorded, the failed step's rows gone and the run's end cleared, all or none. */
  private write(run: RunRow, from: string, head: string | null): void {
    const { db } = this.deps;
    const check = { from };
    db.transaction(() => {
      const { n } = db
        .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM run_resumes WHERE run_id = ?")
        .get(run.id) ?? { n: 0 };
      db.query(
        "INSERT INTO run_resumes (run_id, n, from_step, reason, head, at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(run.id, n + 1, check.from, run.status_reason, head, now());
      // The failed step runs from scratch, with its own items and attempts: the rows the engine
      // names after it (`<id>.<n>` of a parallel, `<id>.check` and `<id>.do` of a loop), taken from
      // its definition, so a step whose id only looks like one of them keeps its result.
      const own = childrenOf(run.definition, from);
      const rows = db
        .query<{ step_id: string; attempt: number; status: string }, [string]>(
          "SELECT step_id, attempt, status FROM step_runs WHERE run_id = ?",
        )
        .all(run.id);
      for (const row of staleRows(rows, check.from, own)) {
        db.query("DELETE FROM step_runs WHERE run_id = ? AND step_id = ? AND attempt = ?").run(
          run.id,
          row.step_id,
          row.attempt,
        );
      }
      db.query(
        `UPDATE workflow_runs SET ended_at = NULL, head_at_end = NULL, status_reason_key = NULL,
         status_reason_params = NULL, status = 'queued', status_reason = NULL WHERE id = ?`,
      ).run(run.id);
    })();
  }

  /**
   * The resumed run got its slot: unless something ended it while it waited, and with the branch
   * still where it was (it may have moved during the wait), it executes; else the slot goes back.
   */
  private async afterSlot(
    runId: string,
    cardId: string,
    worktree: string,
    head: string | null,
  ): Promise<void> {
    const { host, store } = this.deps;
    let held = false;
    try {
      await host.acquire(cardId);
      held = true;
      if (store.row(runId).status !== "queued") {
        host.release(cardId);
        return;
      }
      if (head === null || (await this.deps.headOf(worktree).catch(() => null)) !== head) {
        // The HEAD stays: asked again, the run says the branch moved, not that it has none.
        this.restoreHead(runId, head);
        store.end(runId, "failed", "the card's branch moved while the run waited");
        store.setReasonKey(runId, "run_resume_branch_moved", {});
        host.place(cardId, { type: "workflow", state: "waiting" });
        host.release(cardId);
        return;
      }
      host.place(cardId, { type: "workflow", state: "running" });
      this.deps.begin(runId, worktree);
      // From here the run owns the slot: its own end gives it back, not this catch.
      held = false;
    } catch (error) {
      // The run may be gone (its card discarded meanwhile): its slot still goes back.
      if (held) host.release(cardId);
      try {
        this.restoreHead(runId, head);
        store.end(runId, "failed", reason(error));
        host.place(cardId, { type: "workflow", state: "waiting" });
      } catch {
        // Nothing left to end.
      }
    } finally {
      this.resuming.delete(runId);
    }
  }

  private restoreHead(runId: string, head: string | null): void {
    this.deps.db.query("UPDATE workflow_runs SET head_at_end = ? WHERE id = ?").run(head, runId);
  }
}
