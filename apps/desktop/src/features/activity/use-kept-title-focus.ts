import { type RefObject, useEffect, useRef } from "react";

/**
 * A card that changes column is a new element in another list, so a title the person had focused
 * is removed and the focus falls to the page. This puts it back on the same card's title, but only
 * for a title that was taken away: a person who moved the focus or clicked elsewhere keeps what they
 * chose. `titles` is the board's map from a card's key to its title button (#4509).
 *
 * Returns the function the title's focus and blur events call.
 */
export function useKeptTitleFocus(titles: RefObject<Map<string, HTMLButtonElement>>) {
  const held = useRef<{ key: string; button: HTMLButtonElement } | null>(null);
  useEffect(() => {
    const kept = held.current;
    if (!kept || kept.button.isConnected || document.activeElement !== document.body) return;
    held.current = null;
    titles.current.get(kept.key)?.focus();
  });
  return (key: string, on: boolean) => {
    const button = titles.current.get(key);
    if (on && button) {
      held.current = { key, button };
      return;
    }
    // A blur because the person moved on keeps the button in the page; a removal does not. After the
    // commit the two can be told apart. A title that took the focus meanwhile is not cleared.
    const leaving = held.current;
    queueMicrotask(() => {
      if (held.current === leaving && leaving?.button.isConnected) held.current = null;
    });
  };
}
