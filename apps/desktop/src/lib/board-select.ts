import type { Card } from "@flightdeck/protocol";
import type { T } from "../i18n/index.ts";
import type { Platform } from "../platform/types.ts";

/** Ctrl-click: adds the card to the selection, or takes it out when it is there. */
export function toggleSelection(selected: string[], id: string): string[] {
  void id;
  return selected;
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
  void order;
  void anchor;
  void target;
  return selected;
}

/** The selection without the cards that are gone. */
export function pruneSelection(selected: string[], existing: Iterable<string>): string[] {
  void existing;
  return selected;
}

/** What gestures and actions use: the selected cards that are shown, in the board's order. */
export function shownSelection(selected: string[], shown: string[]): string[] {
  void shown;
  return selected;
}

/** One width for every column, in px (issue #161). */
export const COLUMN_WIDTH = { default: 260, min: 220, max: 520, step: 20 } as const;
export const COLUMN_WIDTH_KEY = "flightdeck.boardColumnWidth";

export function clampWidth(width: number): number {
  return width;
}

/** The columns' width, kept across starts. */
export class BoardWidth {
  value: number = COLUMN_WIDTH.default;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Platform["storage"]) {
    void this.storage;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Sets the width; `persist: false` while a drag is going, then `persist()` when it ends. */
  set(width: number, persist = true): void {
    void width;
    void persist;
  }

  /** Keeps the width across starts; a storage that refuses (quota, private window) is not fatal. */
  persist(): void {}
}

/** A column's count: `3`, or `2 / 5` while a filter hides some. */
export function columnCount(shown: number, total: number, filtering: boolean): string {
  void shown;
  void filtering;
  return String(total);
}

/** The same count in words, for a screen reader: "3 cards", "1 of 3 cards". */
export function countLabel(t: T, shown: number, total: number, filtering: boolean): string {
  void t;
  void shown;
  void total;
  void filtering;
  return "";
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
  void cards;
  void column;
  void request;
  void positions;
  return [];
}

/** The refusal's text and, when the host gave one, its code and values. */
export function answerOf(answer: {
  message: string;
  reason?: string | undefined;
  params?: Record<string, string | number> | undefined;
}): Pick<BulkRefusal, "message" | "reason" | "params"> {
  void answer;
  return { message: "" };
}
