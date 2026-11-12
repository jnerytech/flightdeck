import type { BoardColumn, Card, WorkflowInfo } from "@flightdeck/protocol";
import { cardInFilter, type WorktreeFilter } from "@/features/projects/index.ts";
import type { T } from "../../i18n/index.ts";
import { COLUMNS, filterCards, positionsBefore } from "../../lib/board.ts";
import { reasonText } from "../../lib/notice-text.ts";
import { hasFeature } from "../../lib/version.ts";
import type { BulkRefusal } from "./board-select.ts";

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
  return idsByColumn(shown).flat();
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

/** A column's cards, top to bottom. */
export function columnCards(all: Card[], column: BoardColumn): Card[] {
  return all.filter((card) => card.column === column).sort((a, b) => a.position - b.position);
}

/** The card ids a filter leaves, one list per column, in the board's column order. */
export function idsByColumn(shown: Card[]): string[][] {
  return COLUMNS.map(({ id }) => shown.filter((card) => card.column === id).map((card) => card.id));
}

/** The column a narrow board shows: the one the person picked, else the first with a card, else the first. */
export function showingColumn(picked: BoardColumn | null, ids: string[][]): BoardColumn {
  return picked ?? COLUMNS.find((_, i) => (ids[i]?.length ?? 0) > 0)?.id ?? "backlog";
}

/** Each column's one Tab stop: the card last focused when it is there, else the column's first card. */
export function tabStops(ids: string[][], focused: string | null): Set<string> {
  const stops = new Set<string>();
  for (const column of ids) {
    const stop = focused !== null && column.includes(focused) ? focused : column[0];
    if (stop !== undefined) stops.add(stop);
  }
  return stops;
}

/** One move the card's menu offers: to a column, or up or down within its own (`targetId` is the card it lands before). */
export interface CardMove {
  key: BoardColumn | "up" | "down";
  column: BoardColumn;
  targetId?: string;
  disabled?: boolean;
}

/** The moves the menu offers for a card, and where it sits in its column (`here`, top to bottom). */
export function cardMoves(here: Card[], card: Card): { index: number; moves: CardMove[] } {
  const index = here.findIndex((other) => other.id === card.id);
  return {
    index,
    moves: [
      ...COLUMNS.filter(({ id }) => id !== card.column).map(({ id }) => ({
        key: id,
        column: id,
      })),
      { key: "up", column: card.column, targetId: here[index - 1]?.id, disabled: index <= 0 },
      {
        key: "down",
        column: card.column,
        targetId: here[index + 2]?.id,
        disabled: index === here.length - 1,
      },
    ],
  };
}

/** What the board offers on a host, from the features it announces. */
export function boardFeatures(features: readonly string[] | undefined): {
  deps: boolean;
  roi: boolean;
  sync: boolean;
  issues: boolean;
  memoryPause: boolean;
  cardTemplates: boolean;
} {
  return {
    deps: hasFeature(features, "deps", false),
    roi: hasFeature(features, "roi", false),
    sync: hasFeature(features, "boardsync", false),
    issues: hasFeature(features, "issues", false),
    memoryPause: hasFeature(features, "memoryPause", false),
    cardTemplates: hasFeature(features, "cardTemplates", false),
  };
}

/** The body of a `card.move` request: the position and the force only when given. */
export function cardMoveBody(
  cardId: string,
  column: BoardColumn,
  position?: number,
  force?: boolean,
): { cardId: string; column: BoardColumn; position?: number; force?: boolean } {
  return {
    cardId,
    column,
    ...(position !== undefined ? { position } : {}),
    ...(force ? { force } : {}),
  };
}

/** The host's limit of parallel runs, from its project list answer; null when it gives none. */
export function queueMaxOf(list: { maxParallelRuns?: unknown } | null | undefined): number | null {
  return typeof list?.maxParallelRuns === "number" ? list.maxParallelRuns : null;
}

/** A card shows "queued" only when no reason badge below says why it waits. */
export function showsQueuedBadge(card: Pick<Card, "queued" | "queueReason">): boolean {
  return card.queued && !["quota", "memory", "paused"].includes(card.queueReason ?? "");
}

/** The refused cards named for a notice: each title with the host's reason, in the app's language. */
export function refusalNames(refused: readonly BulkRefusal[], t: T): string {
  return refused
    .map((r) => `${r.card.title} (${reasonText(t, r.message, r.reason, r.params)})`)
    .join(", ");
}
