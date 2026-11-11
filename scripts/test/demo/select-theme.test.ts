import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync("apps/desktop/src/styles.css", "utf8");
const base = css.slice(css.indexOf("@layer base"));

test("the dropdown of a native select is painted with the popover colors, in both themes", () => {
  // WebView2 on Windows paints the popup light in the dark theme even with color-scheme: dark.
  const rule = /select\s+option,\s*select\s+optgroup\s*\{([^}]*)\}/.exec(base);
  expect(rule).not.toBeNull();
  expect(rule?.[1]).toContain("background-color: var(--popover)");
  expect(rule?.[1]).toContain("color: var(--popover-foreground)");
  // The variables change with the theme, so one rule serves both; each theme sets its own scheme.
  expect(base).toContain("html:is(.dark) {\n    color-scheme: dark;");
  expect(base).toContain("html {\n    color-scheme: light;");
});

test("a disabled option is still readable on the popover", () => {
  expect(base).toMatch(/select\s+option:disabled\s*\{[^}]*color:\s*var\(--muted-foreground\)/);
});
