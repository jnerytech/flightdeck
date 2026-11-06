import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(import.meta.dir, "../src/styles.css"), "utf8");
const tabBar = readFileSync(resolve(import.meta.dir, "../src/ui/TabBar.tsx"), "utf8");

/** The body of a named style of styles.css, or "" when there is none. */
function utility(name: string): string {
  const start = css.indexOf(`@utility ${name} {`);
  if (start < 0) return "";
  return css.slice(start, css.indexOf("\n}\n", start));
}

// Issue #488: flat tabs as in VS Code. The prints show the look; these pin the rules it rests on.
describe("tab-look: flat tabs that share the bar, the active one joined to the content", () => {
  test("a tab is as wide as its title, between 6 and 13 rem, with no box of its own", () => {
    const item = utility("tab-item");
    expect(item).toContain("flex: 0 1 auto;");
    expect(item).toContain("min-width: 6rem;");
    expect(item).toContain("max-width: 13rem;");
    expect(item).toContain("border-right: 1px solid var(--color-border);");
    expect(tabBar.includes("rounded-t-md border border-b-0")).toBe(false);
  });

  test("the active tab has the content's background, full-contrast text and an accent line on top", () => {
    const item = utility("tab-item");
    const active = item.slice(item.indexOf('&:has([role="tab"][aria-selected="true"])'));
    expect(active).toContain("background: var(--color-background);");
    expect(active).toContain("color: var(--color-foreground);");
    expect(active).toContain("background: var(--color-primary);");
    expect(item).toContain("color: var(--color-muted-foreground);");
  });
});
