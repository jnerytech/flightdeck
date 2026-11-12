import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (file: string) => readFileSync(join(import.meta.dir, "../../src", file), "utf8");

/**
 * The widths (never under 80 px, never over 13 rem, shrinking before the strip scrolls) and the strip
 * that never widens the page are measured in a real browser by the e2e `layout` journey
 * (`tabWidthsProblem` and the sideways-scroll checks in scripts/e2e/journeys.ts); happy-dom has no
 * layout.
 */
describe("guard: abas-largura: tabs say their title (issue #103)", () => {
  test("a tab says its full title in a tooltip", () => {
    const bar = read("features/tabs/tab-bar.tsx");
    expect(bar).toMatch(/<IconTip label=\{label\}>\s*<button[^>]*\s*type="button"\s*role="tab"/);
    expect(bar).not.toMatch(/role="tab"[\s\S]{0,400}title=\{label\}/);
  });
});
