/**
 * Issue #1344: what happened on this host since a time, read from what the daemon already stores:
 * the sessions that ended, the cards that reached review, the PRs merged or failing, the failed
 * workflow runs and the plan quota. Read-only, and each list is capped.
 */
import type { Database } from "bun:sqlite";
import type { ActivitySinceResult, QuotaWindow } from "@flightdeck/protocol";
import { z } from "zod";
import { parseJsonOr } from "../kernel/index.ts";

/** The values a stored refusal reason fills into its message. */
const REASON_PARAMS = z.record(z.string(), z.union([z.string(), z.number()]));

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
  {
    select,
    from,
    where,
    args,
    order = "at DESC, id DESC",
  }: { select: string; from: string; where: string; args: string[]; order?: string },
  limit: number,
  item: (row: Row) => Item,
): Counted<Item> {
  const rows = db
    .query(`SELECT ${select} FROM ${from} WHERE ${where} ORDER BY ${order} LIMIT ?`)
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
  // A merge is told by when the card was done (`card_done`), which an edit later cannot move; a PR
  // with failing checks only has the card's own change time.
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
      select: `cards.id AS cardId, cards.project_id AS projectId, cards.title AS title,
        CASE WHEN cards.pr_state = 'merged' THEN card_done.done_at ELSE cards.updated_at END AS at,
        cards.pr_url AS prUrl,
        CASE WHEN cards.pr_state = 'merged' THEN 'merged' ELSE 'checks-failed' END AS outcome`,
      from: "cards LEFT JOIN card_done ON card_done.card_id = cards.id",
      where: `cards.pr_url IS NOT NULL AND (
        (cards.pr_state = 'merged' AND card_done.done_at >= ?)
        OR (cards.pr_state = 'open' AND cards.checks_state = 'failing' AND cards.updated_at >= ?))`,
      args: [since, since],
      order: "at DESC, cardId DESC",
    },
    limit,
    (row) => row,
  );
  // Why a run failed is told by its key and params, which the app translates; its free text can
  // carry arbitrary error output and stays out of the digest.
  const failedRuns = newest(
    db,
    {
      select:
        "id AS runId, card_id AS cardId, (SELECT project_id FROM cards WHERE cards.id = workflow_runs.card_id) AS projectId, workflow_name AS workflowName, status_reason_key AS reasonKey, status_reason_params AS params, ended_at AS at",
      from: "workflow_runs",
      where: "status = 'failed' AND ended_at IS NOT NULL AND ended_at >= ?",
      args: [since],
    },
    limit,
    ({
      params,
      ...row
    }: {
      runId: string;
      cardId: string;
      projectId: string;
      workflowName: string;
      reasonKey: string | null;
      params: string | null;
      at: string;
    }): ActivitySinceResult["failedRuns"]["items"][number] => ({
      ...row,
      reasonParams: params === null ? null : parseJsonOr(REASON_PARAMS, params, null),
    }),
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
