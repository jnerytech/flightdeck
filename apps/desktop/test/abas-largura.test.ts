import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (file: string) => readFileSync(join(import.meta.dir, "../src", file), "utf8");
const block = (css: string, name: string) =>
  css.match(new RegExp(`@utility ${name} \\{([^}]*)\\}`))?.[1] ?? "";

describe("abas-largura: tabs share the width like a browser's (issue #103)", () => {
  const css = read("styles.css");

  test("every tab has the same basis and shrinks with the rest, down to a minimum", () => {
    const item = block(css, "tab-item");
    expect(item).toMatch(/flex:\s*0 1 14rem/);
    expect(item).toMatch(/min-width:\s*5rem/);
    expect(item).not.toMatch(/max-width/);
  });

  test("the strip is as wide as its tabs but never wider than its box, which then scrolls", () => {
    const strip = block(css, "tab-strip");
    expect(strip).toMatch(/width:\s*max-content/);
    expect(strip).toMatch(/max-width:\s*100%/);
    expect(block(css, "tab-scroller")).toMatch(/overflow-x:\s*auto/);
  });

  test("a tab says its full title in a tooltip", () => {
    const bar = read("ui/TabBar.tsx");
    expect(bar).toMatch(/<IconTip label=\{label\}>\s*<button[^>]*\s*type="button"\s*role="tab"/);
    expect(bar).not.toMatch(/role="tab"[\s\S]{0,400}title=\{label\}/);
  });
});
