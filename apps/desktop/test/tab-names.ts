/**
 * A tab as the row's suites read it: its accessible name without the ", host X" a host's tab ends
 * with. Only `tab-titles.test.tsx` checks that suffix, so no other suite loses a title if it changes.
 */
export const tabName = (tab: Element): string =>
  (tab.getAttribute("aria-label") ?? tab.textContent ?? "").replace(/, host .*$/, "");
