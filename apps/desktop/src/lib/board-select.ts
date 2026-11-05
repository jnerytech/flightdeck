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
export const COLUMN_WIDTH = { default: 260, min: 220, max: 520, step: 20 } as const;
export const COLUMN_WIDTH_KEY = "flightdeck.boardColumnWidth";

export function clampWidth(width: number): number {
  if (Number.isNaN(width)) return COLUMN_WIDTH.default;
  return Math.min(COLUMN_WIDTH.max, Math.max(COLUMN_WIDTH.min, Math.round(width)));
}

/** The columns' width, kept across starts. */
export class BoardWidth {
  value: number;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Platform["storage"]) {
    const stored = Number(storage.getItem(COLUMN_WIDTH_KEY));
    this.value = Number.isFinite(stored) && stored > 0 ? clampWidth(stored) : COLUMN_WIDTH.default;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Sets the width; `persist: false` while a drag is going, then `persist()` when it ends. */
  set(width: number, persist = true): void {
    this.value = clampWidth(width);
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

/** A column's count: `3`, or `2 / 5` while a filter hides some. */
export function columnCount(shown: number, total: number, filtering: boolean): string {
  // A column that never had a card is just 0: a ratio of nothing says nothing.
  return filtering && total > 0 ? `${shown} / ${total}` : String(shown);
}

/** The same count in words, for a screen reader: "3 cards", "1 of 3 cards". */
export function countLabel(t: T, shown: number, total: number, filtering: boolean): string {
  if (filtering && total > 0) return t("board.countOfMany", { shown, total });
  return shown === 1 ? t("board.countOne") : t("board.countMany", { n: shown });
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
    const answer = await request(card.id, column, positions?.[index]);
    if (!answer.ok) refused.push({ card, ...answerOf(answer) });
  }
  return refused;
}

/** The refusal's text and, when the host gave one, its code and values. */
export function answerOf(answer: {
  message: string;
  reason?: string | undefined;
  params?: Record<string, string | number> | undefined;
}): Pick<BulkRefusal, "message" | "reason" | "params"> {
  return {
    message: answer.message,
    ...(answer.reason
      ? { reason: answer.reason, ...(answer.params ? { params: answer.params } : {}) }
      : {}),
  };
}
