import { type RefObject, useEffect, useRef } from "react";

/** How long a page that is still loading may take to show its heading before the focus gives up. */
const WAIT_MS = 2000;

/** The focus is lost: on the page body, or on something the step removed. */
const focusLost = () => {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
};

/**
 * A step that opens a page (Test and add, Add project, opening a card) removes the control that had
 * the focus, so the browser leaves it on the page body: a screen reader says nothing about the new
 * page and the next Tab starts at the top of the app (#1546). When `navKey` changes and the focus was
 * lost, it goes to the new page's heading, once the page shows one. A focus the person already has on
 * something that stays is left alone, and so is the first page the app shows.
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
    const take = () => {
      if (!focusLost()) return true;
      const found = heading();
      found?.focus();
      return found !== null;
    };
    if (take()) return;
    // The page is still loading: its heading comes in a moment.
    const watch = new MutationObserver(() => {
      if (take()) watch.disconnect();
    });
    watch.observe(root, { childList: true, subtree: true });
    const stop = setTimeout(() => watch.disconnect(), WAIT_MS);
    return () => {
      clearTimeout(stop);
      watch.disconnect();
    };
  }, [navKey]);
}
