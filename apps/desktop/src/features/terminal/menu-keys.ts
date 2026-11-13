import type { KeyboardEvent } from "react";

/** The items of a menu the keys can reach: the ones that are not disabled. */
export const MENU_ITEM = '[role="menuitem"]:not(:disabled)';

/**
 * Up and Down move the focus between the enabled items of `menu` and wrap; Home and End go to its
 * ends (#2608). Returns whether the key was one of those and so was handled.
 */
export function moveInMenu(event: KeyboardEvent, menu: HTMLElement | null): boolean {
  const moves = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!menu || !moves.includes(event.key)) return false;
  const items = Array.from(menu.querySelectorAll<HTMLElement>(MENU_ITEM));
  if (items.length === 0) return false;
  event.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next = {
    ArrowDown: (at + 1) % items.length,
    ArrowUp: (at - 1 + items.length) % items.length,
    Home: 0,
    End: items.length - 1,
  }[event.key as "ArrowDown" | "ArrowUp" | "Home" | "End"];
  items[next]?.focus();
  return true;
}
