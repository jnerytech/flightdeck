import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../../src/styles/layout.css"), "utf8");
/** The body of the `header-crumbs` rule of the stylesheet, or "". */
const crumbs = /@utility header-crumbs \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
/** The rem width the rule gives the box at a window width of `px` (the last `min-width` step that fits). */
function basis(px: number): number {
  let rem = Number(/flex:\s*0 0 (\d+)rem/.exec(crumbs)?.[1] ?? 0);
  for (const step of crumbs.matchAll(
    /@media \(width >= (\d+)px\) \{[^}]*flex-basis:\s*(\d+)rem/g,
  )) {
    if (px >= Number(step[1])) rem = Number(step[2]);
  }
  return rem;
}

// #4414: the box holds the host switcher, the history arrows and the path. At 1280 px the switcher and the
// arrows left a path 140 px: "Hosts › servidor antigo" showed as "Ho… › servidor a…" with 470 px free beside it.
describe("the header's box for the host switcher, the arrows and the path", () => {
  test("a window of 1280 px gives it room for two whole names", () => {
    expect(basis(1280)).toBeGreaterThanOrEqual(32);
  });

  // The tabs start where the box ends, so a window below 1280 px keeps the box it always had.
  test("a window under 1280 px keeps the box of 24rem", () => {
    expect(basis(1279)).toBe(24);
  });
});
