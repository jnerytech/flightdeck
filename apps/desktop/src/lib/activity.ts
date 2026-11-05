import type { AppState, PendingItem } from "./app-store.ts";
import type { HubRow } from "./hub.ts";

/** The columns of the Activity board, in order. (Stub: filled in with the real rules.) */
export type ActivityColumn = "needs_you" | "working" | "done" | "idle";
export const ACTIVITY_COLUMNS: readonly ActivityColumn[] = [];

/** A finished turn counts as Done for this long if it was not opened. */
export const DONE_WINDOW_MS = 0;

export interface ActivityCard {
  column: ActivityColumn;
  row: HubRow;
  /** The repository (or folder) name of the session's project. */
  project: string;
  /** The request waiting for the person, when the session is asking and it can be answered here. */
  pending: PendingItem | null;
  /** When the session last changed, in ms. */
  changedAt: number;
}

export interface ActivityFilter {
  text: string;
  host: string;
  project: string;
  persona: string;
}

export const NO_ACTIVITY_FILTER: ActivityFilter = { text: "", host: "", project: "", persona: "" };

export interface ActivityBoardData {
  columns: Record<ActivityColumn, ActivityCard[]>;
  /** Cards that pass the filter, and all the cards of the columns on show. */
  shown: number;
  total: number;
}

export function activityBoard(
  _state: AppState,
  _now: number,
  _filter: ActivityFilter,
  _showIdle: boolean,
): ActivityBoardData {
  return { columns: { needs_you: [], working: [], done: [], idle: [] }, shown: 0, total: 0 };
}

export function activityOptions(_state: AppState): {
  hosts: string[];
  projects: string[];
  personas: Array<{ id: string; name: string }>;
} {
  return { hosts: [], projects: [], personas: [] };
}
