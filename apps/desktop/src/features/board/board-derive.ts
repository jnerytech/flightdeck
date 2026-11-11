import type { Card, WorkflowInfo } from "@flightdeck/protocol";
import type { WorktreeFilter } from "../../lib/project-tree.ts";

/** The cards the board shows: the text filter, "only blocked" and the branch picked in the sidebar tree. */
export function shownCards(
  _all: Card[],
  _filter: string,
  _onlyBlocked: boolean,
  _treeBranch: WorktreeFilter | null,
): Card[] {
  return [];
}

/** The board's order: column by column, top to bottom, among the cards a filter leaves. */
export function boardOrder(_shown: Card[]): string[] {
  return [];
}

/** Where a dropped group lands among a column's other cards: right before the card it was dropped on. */
export function dropPositions(
  _column: Card[],
  _moving: Card[],
  _targetId: string | undefined,
): number[] | undefined {
  return [];
}

/** The cards still picked after a bulk action: the ones it moved stay picked only when the host refused them. */
export function stayingPicks(
  _before: string[],
  _acted: Iterable<string>,
  _refused: Iterable<string>,
): string[] {
  return [];
}

/** The workflows a card can start with: trusted and free of errors. */
export function startableWorkflows(
  _list: WorkflowInfo[] | undefined,
): Array<{ name: string; inputs: string[] }> {
  return [];
}
