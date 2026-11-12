import type { Card } from "@flightdeck/protocol";
import type { KeyboardEvent, MutableRefObject } from "react";
import { CHORD_TIMEOUT_MS } from "../../lib/shortcuts.ts";
import { type BoardKeyAction, boardKey } from "./board-keys.ts";
import { rangeSelection } from "./board-select.ts";

/** What the board holds while keys act on its cards, and what a key may do to it. */
export interface CardKeyContext {
  /** The last key and when, for the `g` chord. */
  lastKey: MutableRefObject<{ key: string; at: number }>;
  /** Where a Shift range started; `null` when none is going. */
  rangeBase: MutableRefObject<string[] | null>;
  /** The card a range grows from. */
  anchor: MutableRefObject<string | null>;
  /** The cards on screen, column by column. */
  shownIds: readonly (readonly string[])[];
  /** Every card of the board, in the board's order. */
  boardOrder: readonly string[];
  selection: string[];
  cards: readonly Card[];
  focusCard(cardId: string): void;
  select(card: Card): void;
  setPicked(ids: string[]): void;
}

/**
 * A key on a card's title: the arrows move the focus, `s` and `m` are the card's (or the
 * selection's, #1354), `x` toggles it, Shift with an arrow extends the selection, Esc clears it.
 * Returns the action, so the caller can run what is the board's own (start, move, the menu).
 */
export function cardKey(
  ctx: CardKeyContext,
  cardId: string,
  e: KeyboardEvent<HTMLButtonElement>,
): BoardKeyAction {
  const now = Date.now();
  const afterG = ctx.lastKey.current.key === "g" && now - ctx.lastKey.current.at < CHORD_TIMEOUT_MS;
  ctx.lastKey.current = { key: e.key, at: now };
  const action = boardKey(ctx.shownIds, cardId, e, afterG);
  if (action?.kind !== "extend") ctx.rangeBase.current = null;
  if (action?.kind === "focus") ctx.focusCard(action.cardId);
  if (action?.kind === "extend") extend(ctx, cardId, action.cardId);
  if (action?.kind === "toggle") {
    const card = ctx.cards.find((other) => other.id === cardId);
    if (card) ctx.select(card);
  }
  if (action?.kind === "clear") {
    // With no selection Esc goes on (a split view closes); with one it stops here, on the card.
    if (ctx.selection.length === 0) return null;
    e.stopPropagation();
    ctx.anchor.current = null;
    ctx.setPicked([]);
  }
  return action;
}

/** Shift with an arrow: the range from the anchor to the card the focus goes to. */
function extend(ctx: CardKeyContext, from: string, to: string): void {
  // The anchor stays where the range began; with none, the card the focus leaves is it. The
  // range is laid over the selection it started from, so going back shrinks it.
  if (ctx.rangeBase.current === null) {
    ctx.anchor.current ??= from;
    ctx.rangeBase.current = ctx.selection;
  }
  ctx.setPicked(rangeSelection([...ctx.boardOrder], ctx.anchor.current, to, ctx.rangeBase.current));
  ctx.focusCard(to);
}
