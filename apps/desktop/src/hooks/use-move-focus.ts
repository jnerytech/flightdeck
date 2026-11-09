import type { BoardColumn, Card } from "@flightdeck/protocol";
import { type RefObject, useEffect } from "react";

/** The card to focus once a move has happened: where it was, to tell when it has moved. */
export type MoveFocus = { cardId: string; column: BoardColumn; index: number };

/**
 * After a card is moved from its menu, puts the focus back on it where it landed (the menu closed and
 * took the focus with it). It waits for the move to show (the card in another column or place), and a
 * narrow board first follows the card to its column.
 */
export function useMoveFocus(
  wanted: RefObject<MoveFocus | null>,
  input: {
    cards: Card[];
    columnOf(column: BoardColumn): Card[];
    board: RefObject<HTMLElement | null>;
    /** The board shows one column at a time, and which. */
    narrow: boolean;
    showing: BoardColumn;
    onShow(column: BoardColumn): void;
  },
) {
  useEffect(() => {
    const target = wanted.current;
    if (!target) return;
    const card = input.cards.find((other) => other.id === target.cardId);
    if (!card) return;
    const index = input.columnOf(card.column).findIndex((other) => other.id === card.id);
    if (card.column === target.column && index === target.index) return;
    if (input.narrow && card.column !== input.showing) {
      input.onShow(card.column);
      return;
    }
    wanted.current = null;
    input.board.current
      ?.querySelector<HTMLElement>(`li[data-card="${card.id}"] [data-card-open]`)
      ?.focus();
  });
}
