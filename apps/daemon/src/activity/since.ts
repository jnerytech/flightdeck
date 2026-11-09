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

/** Stub: filled in by the next commit. */
export function activitySince(
  _deps: ActivityDeps,
  since: string,
  _limit: number = DEFAULT_ACTIVITY_LIMIT,
): ActivitySinceResult {
  const empty = { items: [], total: 0 };
  return { since, sessions: empty, reviewCards: empty, prs: empty, failedRuns: empty, quota: [] };
}
