import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readStyles } from "../../../../scripts/lib/styles/styles-source.ts";

const css = readStyles(join(import.meta.dir, "../../src/styles.css"));

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

// Issue #2676: the board's columns are minmax(16rem, 1fr), and a folder or project name with no
// spaces cannot break, so its flex item kept its full width and the card spilled out of its column.
describe("activity-card-wrap: a long unbroken name stays inside its card", () => {
  test.each(["activity-card-meta", "activity-card-where"])(
    "%s lets its spans shrink and break anywhere",
    (name) => {
      expect(utility(name)).toMatch(/& > span \{[^}]*min-width: 0[^}]*overflow-wrap: anywhere/);
    },
  );
});
