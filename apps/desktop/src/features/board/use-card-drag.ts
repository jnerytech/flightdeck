import type { BoardColumn, Card } from "@flightdeck/protocol";
import { useRef, useState } from "react";

/**
 * Dragging cards on the board: which card (or selection) is held, the column it is over, and what
 * a drop does. `move` moves one card and may ask first; `moveSelected` moves the whole selection.
 */
export function useCardDrag(input: {
  /** A batch is running: a drop starts nothing. */
  busy: boolean;
  /** The ids a bulk action acts on: the selection, or the card a menu opened on. */
  acting: string[];
  actingCards: Card[];
  move(cardId: string, column: BoardColumn, targetId?: string): void;
  moveSelected(column: BoardColumn, targetId?: string): Promise<unknown>;
}) {
  const { busy, acting, actingCards, move, moveSelected } = input;
  /**
   * Card being dragged. A ref, not state: the drop may come before a re-render. Not in
   * DataTransfer either, which some webviews leave empty.
   */
  const dragging = useRef<string | null>(null);
  /** The cards dragged together when the dragged one is part of a selection. */
  const draggingMany = useRef<string[] | null>(null);
  /** The column a dragged card is over. */
  const [over, setOver] = useState<string | null>(null);
  /** The cards being dragged: the columns that ask for something say what, until they let go. */
  const [dragCards, setDragCards] = useState<Card[]>([]);
  const start = (card: Card) => {
    dragging.current = card.id;
    draggingMany.current = acting.includes(card.id) && acting.length > 1 ? acting : null;
    setDragCards(draggingMany.current ? actingCards : [card]);
  };
  const drop = (column: BoardColumn, targetId?: string) => {
    setOver(null);
    const cardId = dragging.current;
    if (!cardId || busy) return;
    dragging.current = null;
    setDragCards([]);
    // A card dragged out of a selection takes the whole selection with it.
    if (draggingMany.current) {
      draggingMany.current = null;
      void moveSelected(column, targetId);
      return;
    }
    move(cardId, column, targetId);
  };
  return {
    over,
    dragCards,
    start,
    end: () => setDragCards([]),
    enter: (column: string) => setOver(column),
    leave: () => setOver(null),
    drop,
  };
}
