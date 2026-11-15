import type { ActionRunInfo, VaultRequester } from "@flightdeck/protocol";

/** One row of `action_runs`, as SQLite returns it. */
export interface RunRow {
  id: string;
  scope: string;
  name: string;
  requested_by: VaultRequester;
  started_at: string;
  duration_ms: number;
  exit_code: number;
  timed_out: number;
  truncated: number;
  output: string;
}

/** What the app lists of a past run. */
export function runInfoOf(row: RunRow): ActionRunInfo {
  return {
    id: row.id,
    name: row.name,
    projectId: row.scope || null,
    requestedBy: row.requested_by,
    startedAt: row.started_at,
    durationMs: row.duration_ms,
    exitCode: row.exit_code,
    timedOut: row.timed_out === 1,
    truncated: row.truncated === 1,
    output: row.output,
  };
}
