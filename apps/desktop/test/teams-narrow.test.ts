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

/** What applies inside the block's narrow-window media query. */
const narrow = (block: string) => {
  const at = block.indexOf("@media (width < 40rem)");
  return at < 0 ? "" : block.slice(at);
};

// Issue #1006: at 390 px a team member's row kept a 14 rem column for its state and actions, so
// the name and its badges had about 100 px and ran past it (21 px). Narrow, the row stacks: the
// name and badges on one line, the actions under them. happy-dom does not evaluate media queries,
// so the stylesheet's text is the proof; the narrow prints check the screen.
describe("teams-narrow: a team member's row fits a narrow window", () => {
  test("below 640 px the row is one column, so the name and badges get the whole width", () => {
    expect(narrow(utility("member-head"))).toContain("grid-template-columns: minmax(0, 1fr)");
  });

  test("below 640 px the actions start at the left and wrap", () => {
    const actions = narrow(utility("member-end"));
    expect(actions).toContain("justify-content: flex-start");
    expect(actions).toContain("flex-wrap: wrap");
  });
});

// Issue #1222: a worker row of the new-team form kept fixed 7 rem and 10 rem columns at 390 px, so
// the persona picker got a few dozen pixels. Narrow, the row is two columns, and the persona spans
// both. The lean row (a host with no permission modes) sets its own columns after the full one, so
// it needs the same narrow rule, or it would win at 390.
describe("teams-narrow: a worker row of the new-team form fits a narrow window (#1222)", () => {
  for (const name of ["worker-row", "worker-row-lean"]) {
    test(`${name}: below 640 px two even columns`, () => {
      expect(narrow(utility(name))).toContain(
        "grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)",
      );
    });
  }

  test("below 640 px the persona picker spans the row", () => {
    expect(narrow(utility("worker-row"))).toMatch(/& > :first-child \{\s*grid-column: 1 \/ -1;/);
  });
});
