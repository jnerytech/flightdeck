/** A key pressed on a board card, as far as the board reads it (#1198). */
export interface BoardKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** What a key on a focused card does: focus another card, start this one, or show its actions. */
export type BoardKeyAction =
  | { kind: "focus"; cardId: string }
  | { kind: "start" }
  | { kind: "menu" }
  | null;

/**
 * The board's keys (#1198): the arrows, Home and End move between the shown cards (`columns`, the
 * ids column by column), `s` starts the focused card and `m` shows its actions. `afterG` says a
 * go-to chord is waiting (`g s` goes to Sessions), so its second key is the chord's.
 */
export function boardKey(
  columns: readonly (readonly string[])[],
  at: string,
  e: BoardKeyEvent,
  afterG: boolean,
): BoardKeyAction {
  // The context menu key and Shift+F10 are the platform's ways to a menu.
  if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) return { kind: "menu" };
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || afterG) return null;
  if (e.key === "s") return { kind: "start" };
  if (e.key === "m") return { kind: "menu" };
  const col = columns.findIndex((cards) => cards.includes(at));
  const here = columns[col];
  if (!here) return null;
  const row = here.indexOf(at);
  const target = (() => {
    switch (e.key) {
      case "ArrowDown":
        return here[row + 1];
      case "ArrowUp":
        return here[row - 1];
      case "Home":
        return here[0];
      case "End":
        return here[here.length - 1];
      case "ArrowRight":
        return beside(columns.slice(col + 1), row);
      case "ArrowLeft":
        return beside(columns.slice(0, col).reverse(), row);
      default:
        return undefined;
    }
  })();
  return target === undefined || target === at ? null : { kind: "focus", cardId: target };
}

/** The card at `row` (or the last one above it) of the first column with cards, nearest first. */
function beside(nearestFirst: readonly (readonly string[])[], row: number): string | undefined {
  const next = nearestFirst.find((cards) => cards.length > 0);
  return next?.[Math.min(row, next.length - 1)];
}
