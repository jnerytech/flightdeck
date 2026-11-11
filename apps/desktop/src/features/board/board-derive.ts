import type { Card, WorkflowInfo } from "@flightdeck/protocol";
import { COLUMNS, filterCards, positionsBefore } from "../../lib/board.ts";
import { cardInFilter, type WorktreeFilter } from "../../lib/project-tree.ts";

/** The cards the board shows: the text filter, "only blocked" and the branch picked in the sidebar tree. */
export function shownCards(
  all: Card[],
  filter: string,
  onlyBlocked: boolean,
  treeBranch: WorktreeFilter | null,
): Card[] {
  return filterCards(all, filter)
    .filter((card) => !onlyBlocked || card.waitingOn.length > 0)
    .filter((card) => !treeBranch || cardInFilter(card, treeBranch));
}

/** The board's order: column by column, top to bottom, among the cards a filter leaves. */
export function boardOrder(shown: Card[]): string[] {
  return COLUMNS.flatMap(({ id }) =>
    shown.filter((card) => card.column === id).map((card) => card.id),
  );
}

/** Where a dropped group lands among a column's other cards: right before the card it was dropped on. */
export function dropPositions(
  column: Card[],
  moving: Card[],
  targetId: string | undefined,
): number[] | undefined {
  const ids = new Set(moving.map((card) => card.id));
  return targetId && !ids.has(targetId)
    ? positionsBefore(
        column.filter((card) => !ids.has(card.id)),
        targetId,
        moving.length,
      )
    : undefined;
}

/** The cards still picked after a bulk action: the ones it moved stay picked only when the host refused them. */
export function stayingPicks(
  before: string[],
  acted: Iterable<string>,
  refused: Iterable<string>,
): string[] {
  const moved = new Set(acted);
  const stayed = new Set(refused);
  return before.filter((id) => stayed.has(id) || !moved.has(id));
}

/** The workflows a card can start with: trusted and free of errors. */
export function startableWorkflows(
  list: WorkflowInfo[] | undefined,
): Array<{ name: string; inputs: string[] }> {
  return (list ?? [])
    .filter((w) => w.trusted && w.errors.length === 0)
    .map((w) => ({ name: w.name, inputs: w.inputs }));
}
