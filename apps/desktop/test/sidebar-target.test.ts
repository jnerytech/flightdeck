import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");

/** The whole body of a named style, nested rules included. */
function utility(name: string): string {
  const start = css.indexOf(`@utility ${name} {`);
  return start < 0 ? "" : css.slice(start, css.indexOf("\n}", start));
}

// Issue #232: #171 made the nav a column that shrinks, so its items shrank too, under 24 px, and
// axe failed target-size on every screen. The items keep their size; the nav scrolls instead.
describe("sidebar-target: the sidebar's items keep their 24 px when the nav gives way", () => {
  test("the nav's direct children never shrink", () => {
    expect(/& > \* \{\s*flex-shrink: 0;\s*\}/.test(utility("sidebar-nav"))).toBe(true);
  });
});
