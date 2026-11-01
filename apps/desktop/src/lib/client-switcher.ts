import { ALL_CLIENTS, type ClientScope, sessionProjectKeys } from "./client-scope.ts";
import { UNASSIGNED } from "./clients.ts";

/** What the switcher shows beside the clients. */
export interface SwitcherCounts {
  /** Sessions running or waiting for the user, by client id (Unassigned under its own id). */
  busy: Record<string, number>;
  /** The known projects no client claims. */
  projects: number;
  /** Requests waiting in a client other than the selected one (0 while all are shown). */
  othersWaiting: number;
}

export function switcherCounts(
  scope: ClientScope,
  rows: ReadonlyArray<{
    state: string;
    projectKey: string;
    sessionId: string | null;
    claudeSessionId: string | null;
  }>,
  pending: ReadonlyArray<{ sessionId: string }>,
  selection: string,
): SwitcherCounts {
  const busy: Record<string, number> = {};
  for (const row of rows) {
    if (row.state !== "running" && row.state !== "needs_you") continue;
    const id = scope.clientOf(row.projectKey);
    busy[id] = (busy[id] ?? 0) + 1;
  }
  const projects = scope.knownProjects.filter((p) => scope.clientOf(p.key) === UNASSIGNED).length;
  const keys = sessionProjectKeys(rows);
  const othersWaiting =
    selection === ALL_CLIENTS
      ? 0
      : pending.filter((item) => {
          const key = keys.get(item.sessionId);
          return (key === undefined ? UNASSIGNED : scope.clientOf(key)) !== selection;
        }).length;
  return { busy, projects, othersWaiting };
}
