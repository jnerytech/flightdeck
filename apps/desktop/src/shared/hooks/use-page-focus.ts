import { type RefObject, useEffect, useRef } from "react";

/** How long a page that is still loading may take to show its heading before the focus gives up. */
const WAIT_MS = 2000;

/** The focus is lost: on the page body, or on something the step removed. */
export const focusLost = () => {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
};

/**
 * A step that opens a page (Test and add, Add project, opening a card) removes the control that had
 * the focus, so the browser leaves it on the page body: a screen reader says nothing about the new
 * page and the next Tab starts at the top of the app (#1546). When `navKey` changes and the focus was
 * lost, it goes to the new page's heading, once the page shows one. A focus the person already has on
 * something that stays is left alone, and so is the first page the app shows.
 *
 * The browser may refuse the focus: while the dialog that gave the command is still closing, the page
 * behind it takes none, and the focus stays on the body once the dialog goes (#1580). So it is tried
 * again as the document changes, for a short while, until the heading really holds it.
 */
export function usePageFocus(navKey: unknown, content: RefObject<HTMLElement | null>) {
  const first = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per navigation
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const root = content.current;
    if (!root) return;
    const heading = () => root.querySelector<HTMLElement>("[data-slot=page-title]");
    /** True when there is nothing more to do: the heading holds the focus, or the focus is elsewhere to stay. */
    const take = () => {
      if (!focusLost()) return true;
      const found = heading();
      found?.focus();
      return found !== null && document.activeElement === found;
    };
    if (take()) return;
    // The page is still loading, or the browser refused the focus: try again as the page changes.
    // A dialog sits outside the page, so the whole document is watched.
    const watch = new MutationObserver(() => {
      if (take()) watch.disconnect();
    });
    watch.observe(document.body, { childList: true, subtree: true });
    const stop = setTimeout(() => watch.disconnect(), WAIT_MS);
    return () => {
      clearTimeout(stop);
      watch.disconnect();
    };
  }, [navKey]);
}
