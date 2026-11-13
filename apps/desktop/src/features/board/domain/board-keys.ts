/** A key pressed on a board card, as far as the board reads it (#1198). */
export interface BoardKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * What a key on a focused card does: focus another card, start this one, or show its actions; and
 * for a selection (#1354), toggle this card, extend the selection to another card, or clear it.
 */
export type BoardKeyAction =
  | { kind: "focus"; cardId: string }
  | { kind: "extend"; cardId: string }
  | { kind: "start" }
  | { kind: "menu" }
  | { kind: "toggle" }
  | { kind: "clear" }
  | null;

/**
 * The board's keys (#1198): the arrows, Home and End move between the shown cards (`columns`, the
 * ids column by column), `s` starts the focused card and `m` shows its actions. `afterG` says a
 * go-to chord is waiting (`g s` goes to Sessions), so its second key is the chord's. #1354: `x`
 * toggles the focused card in the selection, Shift with an arrow, Home or End moves and extends the
 * selection there, and Esc clears it.
 */
export function boardKey(
  columns: readonly (readonly string[])[],
  at: string,
  e: BoardKeyEvent,
  afterG: boolean,
): BoardKeyAction {
  // The context menu key and Shift+F10 are the platform's ways to a menu.
  if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) return { kind: "menu" };
  if (e.ctrlKey || e.metaKey || e.altKey || afterG) return null;
  if (e.shiftKey) {
    const target = moveTo(columns, at, e.key);
    return target === null ? null : { kind: "extend", cardId: target };
  }
  if (e.key === "s") return { kind: "start" };
  if (e.key === "m") return { kind: "menu" };
  if (e.key === "x") return { kind: "toggle" };
  if (e.key === "Escape") return { kind: "clear" };
  const target = moveTo(columns, at, e.key);
  return target === null ? null : { kind: "focus", cardId: target };
}

/** The card an arrow, Home or End goes to from `at`, or null when it goes nowhere. */
function moveTo(columns: readonly (readonly string[])[], at: string, key: string): string | null {
  const col = columns.findIndex((cards) => cards.includes(at));
  const here = columns[col];
  if (!here) return null;
  const row = here.indexOf(at);
  const target = (() => {
    switch (key) {
      case "ArrowDown":
        return here[row + 1];
      case "ArrowUp":
        return here[row - 1];
      case "Home":
        return here[0];
      case "End":
        return here.at(-1);
      case "ArrowRight":
        return beside(columns.slice(col + 1), row);
      case "ArrowLeft":
        return beside(columns.slice(0, col).reverse(), row);
      default:
        return undefined;
    }
  })();
  return target === undefined || target === at ? null : target;
}

/** The card at `row` (or the last one above it) of the first column with cards, nearest first. */
function beside(nearestFirst: readonly (readonly string[])[], row: number): string | undefined {
  const next = nearestFirst.find((cards) => cards.length > 0);
  return next?.[Math.min(row, next.length - 1)];
}
