import type { Card } from "@flightdeck/protocol";
import { useRef, useState } from "react";
import {
  pruneSelection,
  rangeSelection,
  shownSelection,
  toggleSelection,
} from "./domain/board-select.ts";

/**
 * The cards the person selected on a board (Ctrl-click, Shift-click or the keyboard), which of
 * them the board shows, and the actions that change that selection. `focusBoard` gets the focus
 * back to the board when the selection is cleared.
 */
export function useCardSelection(input: {
  /** Every card of the project. */
  all: Card[];
  /** The cards the board shows, after its filters. */
  shown: Card[];
  /** The shown cards' ids, in the order the board draws them. */
  boardIds: string[];
  focusBoard(): void;
}) {
  const { all, shown, boardIds, focusBoard } = input;
  /** The selected cards (Ctrl-click), the last one picked (the anchor of a Shift range) and what a bulk action left to say. */
  const [picked, setPicked] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  /** A keyboard range (#1354): the selection it started from, so Shift+Up can shrink it back. */
  const rangeBase = useRef<string[] | null>(null);
  const selection = pruneSelection(
    picked,
    all.map((card) => card.id),
  );
  const acting = shownSelection(selection, boardIds);
  const actingCards = acting.flatMap((id) => all.find((card) => card.id === id) ?? []);
  /** Clears the selection and keeps the focus on the board: the bar that had it goes away. */
  const clearSelection = () => {
    anchor.current = null;
    rangeBase.current = null;
    setPicked([]);
    focusBoard();
  };
  const select = (card: Card) => {
    rangeBase.current = null;
    // Only a card just selected anchors the next Shift-click.
    if (!selection.includes(card.id)) anchor.current = card.id;
    else if (anchor.current === card.id) anchor.current = null;
    setPicked(toggleSelection(selection, card.id));
  };
  const selectRange = (card: Card) => {
    rangeBase.current = null;
    const order = shown.filter((other) => other.column === card.column).map((other) => other.id);
    setPicked(rangeSelection(order, anchor.current, card.id, selection));
    anchor.current = card.id;
  };
  return {
    setPicked,
    anchor,
    rangeBase,
    selection,
    acting,
    actingCards,
    clearSelection,
    select,
    selectRange,
  };
}
