import type { Database } from "bun:sqlite";
import { FlightdeckError } from "../errors.ts";
import type { Card, CardRow, CardRun, RunRow } from "./types.ts";

/** The pinned documents of a row: a list of paths, or none when the column is empty or not one. */
function pinnedDocsOf(stored: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(stored ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

const toRun = (row: RunRow): CardRun => ({
  sessionId: row.session_id,
  queuedAt: row.queued_at,
  startedAt: row.started_at,
  endedAt: row.ended_at,
});

/** What reading a card needs of the board (issue #1523); late-bound, so it never imports `board.ts`. */
export interface CardViewPort {
  db: Database;
  /** The status of a run's session, as the session manager has it. */
  sessionStatus: (sessionId: string) => Card["sessionStatus"];
  /** Issue #1405: the cards the conflict radar flagged with this one. */
  mayConflictOf: (id: string) => Pick<Card, "mayConflict">;
  /** Whether a run is a workflow's. */
  isWorkflowRun: (runId: string) => boolean;
  /** Issue #1361: the check loop of the card's row. */
  checkLoopOf: (row: CardRow) => Card["checkLoop"];
  /** Phase 31: the cards a card waits for, the ones it holds and the ones it still waits on. */
  blockers: {
    blockersOf: (id: string) => string[];
    blockingOf: (id: string) => string[];
    unsatisfied: (id: string, when: CardRow["unblock_when"]) => string[];
  };
  /** Why a queued card waits, and until when the quota holds it. */
  queueState: (queued: boolean, projectId: string) => Pick<Card, "queueReason" | "quotaUntil">;
}

/**
 * A card as the app sees it (issue #1523): its row and its runs, with what the radar, the
 * workflows, the check loop, the blockers and the queue say of it.
 */
export class CardView {
  constructor(private readonly port: CardViewPort) {}

  read(id: string): Card {
    const { db } = this.port;
    const row = db.query<CardRow, [string]>("SELECT * FROM cards WHERE id = ?").get(id);
    if (!row)
      throw new FlightdeckError("not_found", `card ${id} does not exist`, "card_not_found", { id });
    const rows = db
      .query<RunRow, [string]>(
        "SELECT * FROM card_runs WHERE card_id = ? ORDER BY queued_at, rowid",
      )
      .all(id);
    const runs = rows.map(toRun);
    const active = rows.at(-1);
    const sessionId = active?.session_id ?? null;
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      column: row.board_column,
      columnLocked: row.column_locked === 1,
      position: row.position,
      slug: row.slug,
      branch: row.branch,
      worktreePath: row.worktree_path,
      prUrl: row.pr_url,
      prState: row.pr_state,
      checksState: row.checks_state,
      prMergeable: row.pr_mergeable,
      prReview: row.pr_review,
      prOpenedAt: row.pr_opened_at,
      ...this.port.mayConflictOf(id),
      queued: active !== undefined && active.started_at === null && active.ended_at === null,
      sessionId,
      sessionStatus: sessionId ? this.port.sessionStatus(sessionId) : null,
      notice: row.notice,
      noticeReason: row.notice_reason,
      noticeParams: row.notice_params ? JSON.parse(row.notice_params) : null,
      discarded: false,
      runs,
      workflowRunId: active && this.port.isWorkflowRun(active.id) ? active.id : null,
      arenaOf: row.arena_of,
      variant: row.variant ? JSON.parse(row.variant) : null,
      arenaVariants: db
        .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM cards WHERE arena_of = ?")
        .get(id)?.n as number,
      issueRef: row.issue_ref,
      issueExternal: row.issue_external === 1,
      externalUrl: row.external_url,
      externalGone: row.external_gone === 1,
      estimateHours: row.estimate_hours,
      validationNote: row.validation_note,
      checkLoop: this.port.checkLoopOf(row),
      specPath: row.spec_path,
      pinnedDocs: pinnedDocsOf(row.pinned_docs),
      startWorkflow: row.start_workflow,
      startPersona: row.start_persona,
      specState:
        row.spec_checked_path === null
          ? null
          : {
              path: row.spec_checked_path,
              found: row.spec_found === 1,
              heading: row.spec_heading,
              ...(row.spec_draft === 1 ? { draft: true } : {}),
            },
      blockedBy: this.port.blockers.blockersOf(id),
      blocking: this.port.blockers.blockingOf(id),
      waitingOn: rows.length === 0 ? this.port.blockers.unsatisfied(id, row.unblock_when) : [],
      unblockWhen: row.unblock_when,
      autoStart: row.auto_start ? JSON.parse(row.auto_start) : null,
      unblockedAt: row.unblocked_at,
      ...this.port.queueState(
        active !== undefined && active.started_at === null && active.ended_at === null,
        row.project_id,
      ),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
