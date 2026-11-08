import type { Card } from "@flightdeck/protocol";
import type { T } from "../i18n/index.ts";
import type { Platform } from "../platform/types.ts";

/** Ctrl-click: adds the card to the selection, or takes it out when it is there. */
export function toggleSelection(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((other) => other !== id) : [...selected, id];
}

/**
 * Shift-click: the cards from the anchor to `target` in the column's order join the selection (what
 * was selected elsewhere stays). With no anchor in this column it is the target alone.
 */
export function rangeSelection(
  order: string[],
  anchor: string | null,
  target: string,
  selected: string[],
): string[] {
  const from = anchor === null ? -1 : order.indexOf(anchor);
  const to = order.indexOf(target);
  const range =
    from < 0 || to < 0 ? [target] : order.slice(Math.min(from, to), Math.max(from, to) + 1);
  return [...selected, ...range.filter((id) => !selected.includes(id))];
}

/** The selection without the cards that are gone. */
export function pruneSelection(selected: string[], existing: Iterable<string>): string[] {
  const alive = new Set(existing);
  return selected.filter((id) => alive.has(id));
}

/** What gestures and actions use: the selected cards that are shown, in the board's order. */
export function shownSelection(selected: string[], shown: string[]): string[] {
  return shown.filter((id) => selected.includes(id));
}

/** One width for every column, in px (issue #161). */
export const COLUMN_WIDTH = { default: 260, min: 180, max: 520, step: 20 } as const;
export const COLUMN_WIDTH_KEY = "flightdeck.boardColumnWidth";

/** The gap between two columns, in px: the board row's `gap-3`. */
export const COLUMN_GAP = 12;

/** The room the last column's resize handle takes past its edge, in px (`-right-2`, 8 px wide). */
export const HANDLE_ROOM = 8;

/**
 * Issue #1030: the width that lets `count` columns, `gap` px apart, share a board `board` px wide,
 * with room for the last handle so the row does not scroll. A board too narrow for columns of
 * the minimum width keeps the usual width and scrolls, as it always did.
 */
export function fitColumnWidth(board: number, count: number, gap: number): number {
  if (board <= 0) return COLUMN_WIDTH.default;
  const fit = Math.floor((board - HANDLE_ROOM - gap * (count - 1)) / count);
  return fit < COLUMN_WIDTH.min ? COLUMN_WIDTH.default : clampWidth(fit);
}

export function clampWidth(width: number): number {
  if (Number.isNaN(width)) return COLUMN_WIDTH.default;
  return Math.min(COLUMN_WIDTH.max, Math.max(COLUMN_WIDTH.min, Math.round(width)));
}

/** The columns' width, kept across starts. */
export class BoardWidth {
  value: number;
  /** True once the person has set a width, or one was kept: until then the columns share the board. */
  chosen = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Platform["storage"]) {
    let stored = Number.NaN;
    try {
      stored = Number(storage.getItem(COLUMN_WIDTH_KEY));
    } catch {
      // A storage that cannot be read (a private window): the default width.
    }
    this.chosen = Number.isFinite(stored) && stored > 0;
    this.value = this.chosen ? clampWidth(stored) : COLUMN_WIDTH.default;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Sets the width; `persist: false` while a drag is going, then `persist()` when it ends. */
  set(width: number, persist = true): void {
    this.value = clampWidth(width);
    this.chosen = true;
    if (persist) this.persist();
    for (const listener of this.listeners) listener();
  }

  /** Keeps the width across starts; a storage that refuses (quota, private window) is not fatal. */
  persist(): void {
    try {
      this.storage.setItem(COLUMN_WIDTH_KEY, String(this.value));
    } catch {
      // The width still holds for this run.
    }
  }
}

/** A column's count: `3`. */
// NOSONAR: the board names the step it shows, and tests call it by that name
export function columnCount(shown: number): string {
  return String(shown);
}

/** A column's count while a filter is on: `2 / 5` when it hides some. */
export function filteredColumnCount(shown: number, total: number): string {
  // A column that never had a card is just 0: a ratio of nothing says nothing.
  return total > 0 ? `${shown} / ${total}` : String(shown);
}

/** The same count in words, for a screen reader: "3 cards". */
export function countLabel(t: T, shown: number): string {
  return shown === 1 ? t("board.countOne") : t("board.countMany", { n: shown });
}

/** The same count in words while a filter is on: "1 of 3 cards". */
export function filteredCountLabel(t: T, shown: number, total: number): string {
  return total > 0 ? t("board.countOfMany", { shown, total }) : countLabel(t, shown);
}

/** The outcome of moving many cards at once: the ones the host refused, with its reason. */
export interface BulkRefusal {
  card: Card;
  message: string;
  /** The host's code and values for the message, to say it in the app's language. */
  reason?: string;
  params?: Record<string, string | number>;
}

/** What asks the host to move a card without raising a toast of its own. */
export type MoveRequest = (
  cardId: string,
  column: Card["column"],
  position?: number,
) => Promise<
  | { ok: true }
  | { ok: false; message: string; reason?: string; params?: Record<string, string | number> }
>;

/** Moves each card to `column`, in order, one after the other; the refused ones come back named. */
export async function moveMany(
  cards: Card[],
  column: Card["column"],
  request: MoveRequest,
  /** One position per card, in order, when the group was dropped on a card. */
  positions?: number[],
): Promise<BulkRefusal[]> {
  const refused: BulkRefusal[] = [];
  for (const [index, card] of cards.entries()) {
    const answer = await request(card.id, column, positions?.[index]); // NOSONAR: the cards move in the order given; the host numbers each position after the one before
    if (!answer.ok) refused.push({ card, ...answerOf(answer) });
  }
  return refused;
}

/** The refusal's text and, when the host gave one, its code and values. */
export function answerOf(answer: {
  message: string;
  reason?: string;
  params?: Record<string, string | number>;
}): Pick<BulkRefusal, "message" | "reason" | "params"> {
  return {
    message: answer.message,
    ...(answer.reason
      ? { reason: answer.reason, ...(answer.params ? { params: answer.params } : {}) }
      : {}),
  };
}
