/**
 * A weakened assertion (#1141): docs/TDD.md forbids weakening an assertion to make a test pass. An
 * edit weakens when, within that one edit, strict matchers go down and weak ones go up. A weak
 * matcher on a line with `// weaker: <why>` is a reviewed swap and does not count.
 */

/** How many strict and weak matchers a text holds; `escaped` counts the `// weaker:` lines. */
export function assertionCounts(_text: string): { strict: number; weak: number; escaped: number } {
  return { strict: 0, weak: 0, escaped: 0 };
}

/** Whether replacing `before` with `after` swaps strict matchers for weak ones. */
export function weakensAssertions(_before: string, _after: string): boolean {
  return false;
}
