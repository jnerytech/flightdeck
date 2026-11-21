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
    const bar = read("features/tabs/tab-item.tsx");
    expect(bar).toMatch(/<IconTip label=\{label\}>\s*<button[^>]*\s*type="button"\s*role="tab"/);
    expect(bar).not.toMatch(/role="tab"[\s\S]{0,400}title=\{label\}/);
  });

  // Issue #3794: at 6 rem the icon, the close slot and the padding left room for one or two letters
  // of the title, so ten tabs of one screen all read "O...". happy-dom has no layout, so the
  // stylesheet's text is the proof; the e2e `layout` journey measures the widths.
  test("a tab keeps at least 9 rem, so the start of its title shows (#3794)", () => {
    const css = read("styles/tabs.css");
    const rule = css.slice(css.indexOf("@utility tab-item {"));
    expect(/min-width: 9rem;/.test(rule.slice(0, rule.indexOf("max-width")))).toBe(true);
  });
});
