import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readStyles } from "../../lib/styles/styles-source.ts";
import { colorOf, contrast, tokensOf } from "../../lib/styles/theme-contrast.ts";

const css = readStyles(join(import.meta.dir, "../../../apps/desktop/src/styles.css"));

// Issue #567: Windows drew its native scrollbars, arrows and all, in every scroll area. One app-wide
// style: thin, no arrow buttons, a theme thumb that shows on hover. WebView2 (Chromium) takes the
// ::-webkit-scrollbar rules only while scrollbar-width and scrollbar-color are unset, so the
// standard properties stay behind @supports for the engines without the webkit ones. The bar's size
// and its missing arrows are measured by the e2e `layout-medido` journey (#1850); here, the thumb's
// contrast in each theme.
describe("scrollbar-style: one thin scrollbar with no arrows, in both themes (#567)", () => {
  test("the thumb is a token of each theme with 3:1 against the surfaces it scrolls over (WCAG 1.4.11)", () => {
    const light = tokensOf(css, ":root");
    const dark = new Map([...light, ...tokensOf(css, ".dark")]);
    for (const [theme, vars] of [
      ["light", light],
      ["dark", dark],
    ] as const) {
      const thumb = colorOf(vars.get("--scrollbar-thumb"), vars);
      expect([theme, thumb !== null]).toEqual([theme, true]);
      for (const surface of ["--background", "--sidebar", "--popover"]) {
        const under = colorOf(vars.get(surface), vars);
        const ratio = thumb && under ? contrast(thumb, under) : 0;
        expect([theme, surface, ratio >= 3]).toEqual([theme, surface, true]);
      }
    }
    expect(tokensOf(css, ".dark").has("--scrollbar-thumb")).toBe(true);
  });
});
