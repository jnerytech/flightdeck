import type { HistoryOrigin } from "@flightdeck/protocol";
import type { HistoryFilter } from "../store.ts";

export interface Draft {
  cwd: string;
  /** Set by a usage row of a remote project; the chip clears it. */
  projectKey: string;
  from: string;
  to: string;
  origin: "" | HistoryOrigin;
}

/** Why the list is empty once it is read: the hidden automated runs, the filters, or nothing yet. */
export function emptyReason(why: {
  open: boolean;
  automated: boolean;
  filtered: boolean;
}): "automated" | "filtered" | "nothing" | null {
  if (!why.open) return null;
  if (why.automated) return "automated";
  return why.filtered ? "filtered" : "nothing";
}

/** Date inputs give whole days; the daemon compares ISO timestamps (UTC). */
export function toFilter(draft: Draft): HistoryFilter {
  return {
    ...(draft.cwd.trim() ? { cwd: draft.cwd.trim() } : {}),
    ...(draft.projectKey ? { projectKey: draft.projectKey } : {}),
    ...(draft.from ? { from: `${draft.from}T00:00:00.000Z` } : {}),
    ...(draft.to ? { to: `${draft.to}T23:59:59.999Z` } : {}),
    ...(draft.origin ? { origin: draft.origin } : {}),
  };
}
