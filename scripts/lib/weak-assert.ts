/**
 * A weakened assertion (#1141): docs/TDD.md forbids weakening an assertion to make a test pass. An
 * edit weakens when, within that one edit, strict matchers go down and weak ones go up. A weak
 * matcher on a line with `// weaker: <why>` is a reviewed swap and does not count.
 */

/**
 * A matcher that names the value it expects. `toEqual(expect.anything())` names none, and
 * `toBe(true)` / `toBe(false)` count as neither: `expect(x !== null).toBe(true)` says no more than
 * `expect(x).not.toBeNull()`, the swap Sonar asks for.
 */
const STRICT =
  /\.(?:toBe|toEqual|toStrictEqual|toContain|toContainEqual|toMatch|toMatchObject|toThrow|toHaveLength)\((?!\s*expect\.anything\(\))(?!\s*(?:true|false)\s*,?\s*\))/g;

/** A matcher that only says something is there, or is truthy. */
const WEAK =
  /\.(?:toBeTruthy|toBeDefined|toBeFalsy)\(\)|\.not\.(?:toBeNull|toBeUndefined)\(\)|\bexpect\.anything\(\)/g;

/** The reviewed escape: `// weaker: ` and at least one word of why. */
const ESCAPE = /\/\/ weaker: \S/;

const count = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].length;

/** How many strict and weak matchers a text holds; `escaped` counts the `// weaker:` lines. */
export function assertionCounts(text: string): { strict: number; weak: number; escaped: number } {
  // Strict over the whole text, since a formatter puts `true,` on the line after `toBe(`; weak per
  // line, where its escape is.
  const counts = { strict: count(text, STRICT), weak: 0, escaped: 0 };
  for (const line of text.split("\n")) {
    const weak = count(line, WEAK);
    if (weak > 0 && ESCAPE.test(line)) counts.escaped += 1;
    else counts.weak += weak;
  }
  return counts;
}

/** Whether replacing `before` with `after` swaps strict matchers for weak ones. */
export function weakensAssertions(before: string, after: string): boolean {
  const was = assertionCounts(before);
  const now = assertionCounts(after);
  return now.strict < was.strict && now.weak > was.weak;
}
