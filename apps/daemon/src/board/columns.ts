import type { SessionStatus } from "@flightdeck/protocol";
import type { BoardColumn, PrState } from "./types.ts";

/** What can move a card (docs/SPEC-fase-4.md, "Colunas automáticas"). */
export type BoardEvent =
  /** Started: waiting for a slot, preparing or already running. */
  | { type: "started" }
  | { type: "session"; status: SessionStatus }
  /** A turn ended; an interrupted turn (card.stop) is an error. */
  | { type: "turn"; isError: boolean }
  | { type: "pr"; state: PrState }
  /** Setup script or worktree failed before the session. */
  | { type: "failed" }
  | { type: "moved"; column: BoardColumn };

export interface Placement {
  column: BoardColumn;
  locked: boolean;
}

const SESSION_COLUMNS: Partial<Record<SessionStatus, BoardColumn>> = {
  starting: "in_progress",
  running: "in_progress",
  awaiting_permission: "waiting",
  error: "waiting",
};

const PR_COLUMNS: Record<PrState, BoardColumn> = {
  open: "review",
  merged: "done",
  closed: "waiting",
};

/** Moved by hand to these, a card stays put until the next start. */
const LOCKING: ReadonlySet<BoardColumn> = new Set(["backlog", "done"]);

/**
 * Where a card goes after `event`. `idle` alone moves nothing: resumed sessions reach it without
 * a turn, so "Em revisão" follows `turn.result` instead.
 */
export function nextColumn(current: Placement, event: BoardEvent): Placement {
  if (event.type === "moved") return { column: event.column, locked: LOCKING.has(event.column) };
  if (event.type === "started") return { column: "in_progress", locked: false };
  if (current.locked) return current;
  const column = target(event) ?? current.column;
  return { column, locked: false };
}

function target(
  event: Exclude<BoardEvent, { type: "moved" | "started" }>,
): BoardColumn | undefined {
  switch (event.type) {
    case "session":
      return SESSION_COLUMNS[event.status];
    case "turn":
      return event.isError ? "waiting" : "review";
    case "pr":
      return PR_COLUMNS[event.state];
    case "failed":
      return "waiting";
  }
}
