/** The few members `revealTab` reads and moves. */
export interface Box {
  getBoundingClientRect(): { left: number; right: number };
  scrollLeft: number;
}

/**
 * Scrolls `box` sideways, by as little as it takes, until `tab` is in view (#1430). Not
 * `scrollIntoView`: Chromium moves the Tab key's starting point to what that scrolls to, so the
 * first Tab of a wide window skipped "Skip to content" and landed in the tab strip.
 */
export function revealTab(box: Box, tab: Pick<Box, "getBoundingClientRect">): void {
  const outer = box.getBoundingClientRect();
  const inner = tab.getBoundingClientRect();
  if (inner.left < outer.left) box.scrollLeft -= outer.left - inner.left;
  else if (inner.right > outer.right) box.scrollLeft += inner.right - outer.right;
}
