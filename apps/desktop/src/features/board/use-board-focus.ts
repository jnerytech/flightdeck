import type { BoardColumn, Card } from "@flightdeck/protocol";
import { type KeyboardEvent, type RefObject, useEffect, useRef } from "react";
import { cardKey } from "./board-card-keys.ts";

/**
 * Where the keyboard focus goes on the board: a card's title is looked up in the columns, a narrow
 * board first shows the card's column (the focus waits for it), and a key on a title becomes the
 * action `cardKey` returns. `titleOf` and `keyOn` come back for the board's own markup.
 */
export function useBoardFocus(input: {
  board: RefObject<HTMLElement | null>;
  cards: Card[];
  /** The board shows one column at a time, which one, and how to change it. */
  narrow: boolean;
  showing: BoardColumn;
  onShow(column: BoardColumn): void;
  /** What `cardKey` reads and may change (selection and range). */
  keys: Omit<Parameters<typeof cardKey>[0], "lastKey" | "cards" | "focusCard">;
}) {
  const { board, cards, narrow, showing, onShow, keys } = input;
  /** A card to focus once its column shows; the last key, to leave `g s` to the go-to chord. */
  const pendingFocus = useRef<string | null>(null);
  const lastKey = useRef({ key: "", at: 0 });
  const titleOf = (cardId: string) =>
    board.current?.querySelector<HTMLElement>(`li[data-card="${cardId}"] [data-card-open]`);
  /** Focuses a card, showing its column first on a narrow board. */
  const focusCard = (cardId: string) => {
    const column = cards.find((card) => card.id === cardId)?.column;
    if (narrow && column && column !== showing) {
      pendingFocus.current = cardId;
      onShow(column);
      return;
    }
    titleOf(cardId)?.focus();
  };
  useEffect(() => {
    const cardId = pendingFocus.current;
    if (cardId === null) return;
    pendingFocus.current = null;
    titleOf(cardId)?.focus();
  });
  /** A key on a card's title (see `cardKey`): the action comes back for what is the board's own. */
  const keyOn = (cardId: string) => (e: KeyboardEvent<HTMLButtonElement>) =>
    cardKey({ ...keys, lastKey, cards, focusCard }, cardId, e);
  return { titleOf, keyOn };
}
