import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { readStyles } from "../../../../scripts/lib/styles/styles-source.ts";

const css = readStyles(resolve(import.meta.dir, "../../src/styles.css"));

/** The body of a named style of styles.css, or "" when there is none. */
function utility(name: string): string {
  const start = css.indexOf(`@utility ${name} {`);
  if (start < 0) return "";
  return css.slice(start, css.indexOf("\n}\n", start));
}

/**
 * Issue #488: flat tabs as in VS Code. The e2e `layout` journey measures the widths, the borders, the
 * colors and the line under the bar (`flatTabsProblem`, `activeTabProblem`); it does not read which
 * color the active line takes, so that one rule stays pinned here.
 */
describe("tab-look: the active tab's line takes the host's color", () => {
  test("the line is the host's color on a host's tab (#644), the accent on a shared one", () => {
    const item = utility("tab-item");
    const active = item.slice(item.indexOf('&:has([role="tab"][aria-selected="true"])'));
    expect(active).toContain("background: var(--host-color, var(--color-primary));");
  });
});
