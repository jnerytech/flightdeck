import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { colorOf, contrast, tokensOf } from "../lib/theme-contrast.ts";

const css = readFileSync(join(import.meta.dir, "../../apps/desktop/src/styles.css"), "utf8");

/** The declarations of the first rule whose selector line is exactly `selector {`. */
function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  return start < 0 ? "" : css.slice(start, css.indexOf("}", start));
}

/** The whole `@supports not selector(::-webkit-scrollbar)` block, nested rules included. */
function standardBlock(): string {
  const start = css.indexOf("@supports not selector(::-webkit-scrollbar) {");
  return start < 0 ? "" : css.slice(start, css.indexOf("\n  }\n", start));
}

// Issue #567: Windows drew its native scrollbars, arrows and all, in every scroll area. One app-wide
// style: thin, no arrow buttons, a theme thumb that shows on hover. WebView2 (Chromium) takes the
// ::-webkit-scrollbar rules only while scrollbar-width and scrollbar-color are unset, so the
// standard properties stay behind @supports for the engines without the webkit ones.
describe("scrollbar-style: one thin scrollbar with no arrows, in both themes (#567)", () => {
  test("WebView2 gets a thin bar with no arrow buttons and a thumb that shows on hover", () => {
    expect(rule("::-webkit-scrollbar")).toMatch(/width:\s*(?:[4-9]|10)px/);
    expect(rule("::-webkit-scrollbar")).toMatch(/height:\s*(?:[4-9]|10)px/);
    expect(rule("::-webkit-scrollbar-button")).toMatch(/display:\s*none/);
    expect(rule("::-webkit-scrollbar-thumb")).toMatch(/background-color:\s*transparent/);
    expect(rule(":hover::-webkit-scrollbar-thumb")).toMatch(
      /background-color:\s*var\(--scrollbar-thumb\)/,
    );
  });

  test("other engines get scrollbar-width and scrollbar-color, and only where the webkit rules are missing", () => {
    const standard = standardBlock();
    expect(standard).toMatch(/scrollbar-width:\s*thin/);
    expect(standard).toMatch(/scrollbar-color:\s*var\(--scrollbar-thumb\) transparent/);
    const outside = css.replace(standard, "");
    expect(outside.match(/scrollbar-color:/g) ?? []).toEqual([]);
    expect(outside.match(/scrollbar-width:\s*\w+/g) ?? []).toEqual(["scrollbar-width: none"]);
  });

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
