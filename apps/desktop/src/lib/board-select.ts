import type { Card } from "@flightdeck/protocol";
import type { Platform } from "../platform/types.ts";

/** Ctrl-click: adds the card to the selection, or takes it out when it is there. */
export function toggleSelection(selected: string[], id: string): string[] {
  void selected;
  void id;
  return [];
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
  void selected;
  return [];
}

/** The selection without the cards that are gone. */
export function pruneSelection(selected: string[], existing: Iterable<string>): string[] {
  void existing;
  return selected;
}

/** What gestures and actions use: the selected cards that are shown, in the board's order. */
export function shownSelection(selected: string[], shown: string[]): string[] {
  void selected;
  return shown;
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

  set(width: number): void {
    void width;
  }
}

/** A column's count: `3`, or `2 / 5` while a filter hides some. */
export function columnCount(shown: number, total: number, filtering: boolean): string {
  void shown;
  void total;
  void filtering;
  return "";
}

/** The outcome of moving many cards at once: the ones the host refused, with its reason. */
export interface BulkRefusal {
  card: Card;
  message: string;
}

/** What asks the host to move a card without raising a toast of its own. */
export type MoveRequest = (
  cardId: string,
  column: Card["column"],
) => Promise<{ ok: true } | { ok: false; message: string }>;

/** Moves each card to `column`, in order, one after the other; the refused ones come back named. */
export async function moveMany(
  cards: Card[],
  column: Card["column"],
  request: MoveRequest,
): Promise<BulkRefusal[]> {
  void cards;
  void column;
  void request;
  return [{ card: {} as Card, message: "?" }];
}
