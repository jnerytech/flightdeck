import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");

/** The body of one `@utility` block, nested rules included. */
function utility(name: string): string {
  const start = css.indexOf(`@utility ${name} {`);
  if (start < 0) return "";
  let depth = 0;
  for (let at = css.indexOf("{", start); at < css.length; at++) {
    if (css[at] === "{") depth++;
    if (css[at] === "}" && --depth === 0) return css.slice(start, at + 1);
  }
  return "";
}

// Issue #1167: in a narrow list pane (640 px, about 260 px of list) a waiting row read
// "Corri… [terminal] W…", and at 1024 the full state word cut the title to eight characters.
// The title is the row's name; the word is the second thing. The title keeps up to 40% of the row
// before the word gives way, and below 20 rem of list the word goes (the dot's glyph and label
// still say the state, and the summary keeps the word for a screen reader). happy-dom does not
// evaluate container queries, so the stylesheet's text is the proof; the narrow prints check
// the screen.
describe("hub-row-narrow: a narrow list keeps the session's title readable (#1167)", () => {
  test("the title keeps up to 40% of the row before the word gives way", () => {
    expect(utility("row-title").includes("min-width: min(9rem, 40%)")).toBe(true);
  });

  test("below 20 rem of list the state word is hidden", () => {
    expect(/@container \(width < 20rem\)\s*\{\s*display: none;/.test(utility("row-word"))).toBe(
      true,
    );
  });
});
