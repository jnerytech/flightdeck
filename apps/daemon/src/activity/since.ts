/**
 * Issue #1344: what happened on this host since a time, read from what the daemon already stores:
 * the sessions that ended, the cards that reached review, the PRs merged or failing, the failed
 * workflow runs and the plan quota. Read-only, and each list is capped.
 */
import type { Database } from "bun:sqlite";
import type { ActivitySinceResult, QuotaWindow } from "@flightdeck/protocol";

export const DEFAULT_ACTIVITY_LIMIT = 20;

export interface ActivityDeps {
  db: Database;
  /** The plan quota windows now; absent when this host does not read them. */
  quota?: () => QuotaWindow[];
}

interface Counted<T> {
  items: T[];
  total: number;
}

/** The newest `limit` rows of `from ... where` by `at`, and how many rows match in all. */
function newest<Row, Item>(
  db: Database,
  { select, from, where, args }: { select: string; from: string; where: string; args: string[] },
  limit: number,
  item: (row: Row) => Item,
): Counted<Item> {
  const rows = db
    .query(`SELECT ${select} FROM ${from} WHERE ${where} ORDER BY at DESC, id DESC LIMIT ?`)
    .all(...args, limit) as Row[];
  const total = db.query(`SELECT count(*) AS n FROM ${from} WHERE ${where}`).get(...args) as {
    n: number;
  };
  return { items: rows.map(item), total: total.n };
}

/** What happened since `since` (an ISO time); each list has its newest `limit` items and its total. */
export function activitySince(
  { db, quota }: ActivityDeps,
  since: string,
  limit: number = DEFAULT_ACTIVITY_LIMIT,
): ActivitySinceResult {
  const sessions = newest<
    { id: string; name: string | null; cwd: string; at: string },
    ActivitySinceResult["sessions"]["items"][number]
  >(
    db,
    {
      select: "id, name, cwd, updated_at AS at",
      from: "sessions",
      where: "status = 'ended' AND updated_at >= ?",
      args: [since],
    },
    limit,
    (row) => row,
  );
  const cardOf = (row: { cardId: string; projectId: string; title: string; at: string }) => row;
  const reviewCards = newest(
    db,
    {
      select: "id AS cardId, project_id AS projectId, title, updated_at AS at",
      from: "cards",
      where: "board_column = 'review' AND updated_at >= ?",
      args: [since],
    },
    limit,
    cardOf,
  );
  const prs = newest<
    {
      cardId: string;
      projectId: string;
      title: string;
      at: string;
      prUrl: string;
      outcome: "merged" | "checks-failed";
    },
    ActivitySinceResult["prs"]["items"][number]
  >(
    db,
    {
      select: `id AS cardId, project_id AS projectId, title, updated_at AS at, pr_url AS prUrl,
        CASE WHEN pr_state = 'merged' THEN 'merged' ELSE 'checks-failed' END AS outcome`,
      from: "cards",
      where:
        "pr_url IS NOT NULL AND updated_at >= ? AND (pr_state = 'merged' OR (pr_state = 'open' AND checks_state = 'failing'))",
      args: [since],
    },
    limit,
    (row) => row,
  );
  const failedRuns = newest(
    db,
    {
      select:
        "id AS runId, card_id AS cardId, workflow_name AS workflowName, status_reason AS reason, ended_at AS at",
      from: "workflow_runs",
      where: "status = 'failed' AND ended_at IS NOT NULL AND ended_at >= ?",
      args: [since],
    },
    limit,
    (row: {
      runId: string;
      cardId: string;
      workflowName: string;
      reason: string | null;
      at: string;
    }) => row,
  );
  return {
    since,
    sessions,
    reviewCards,
    prs,
    failedRuns,
    quota: (quota?.() ?? []).map(({ window, utilization }) => ({ window, utilization })),
  };
}
