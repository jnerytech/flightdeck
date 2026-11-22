/** The few members `revealTab` reads and moves. */
export interface Box {
  getBoundingClientRect(): { left: number; right: number };
  scrollLeft: number;
}

/**
 * Scrolls `box` sideways, by as little as it takes, until `tab` is in view (#1430). Not
 * `scrollIntoView`: Chromium moves the Tab key's starting point to what that scrolls to, so the
 * first Tab of a wide window skipped "Skip to content" and landed in the tab strip. `inset` keeps the
 * tab that many pixels inside each edge, clear of an edge fade.
 */
export function revealTab(box: Box, tab: Pick<Box, "getBoundingClientRect">, inset = 0): void {
  const outer = box.getBoundingClientRect();
  const inner = tab.getBoundingClientRect();
  if (inner.left < outer.left + inset) box.scrollLeft -= outer.left + inset - inner.left;
  else if (inner.right > outer.right - inset) box.scrollLeft += inner.right - (outer.right - inset);
}
