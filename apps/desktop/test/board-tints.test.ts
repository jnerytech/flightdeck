import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contrastRatio } from "../src/lib/contrast.ts";

const css = readFileSync(resolve(import.meta.dir, "../src/styles.css"), "utf8");

/** `--name: value;` declarations of the first `selector { … }` block of styles.css. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1] as string, m[2] as string]),
  );
}

const COLUMNS = ["backlog", "progress", "waiting", "review", "done"];

/** The column's faint tint over the background: 8% of the tone, in oklch. */
function tinted(tone: string, background: string): string {
  const parse = (c: string) =>
    (/oklch\(([\d.]+) ([\d.]+) ([\d.]+)/.exec(c) ?? []).slice(1).map(Number);
  const [bl = 0, bc = 0, bh = 0] = parse(background);
  const [tl = 0, tc = 0, th = 0] = parse(tone);
  void bh;
  return `oklch(${bl * 0.92 + tl * 0.08} ${bc * 0.92 + tc * 0.08} ${th})`;
}

describe("board-tints: the columns are tinted by status in both themes", () => {
  test("every column has a tone in the light and the dark theme", () => {
    for (const selector of [":root", ".dark"]) {
      const t = tokens(selector);
      for (const column of COLUMNS) {
        expect(`${selector} ${column}: ${t[`--column-${column}`] ?? "missing"}`).toMatch(/oklch\(/);
      }
    }
  });

  test("the tone is a visible line (3:1) and the text on its tint stays AA, in both themes", () => {
    for (const selector of [":root", ".dark"]) {
      const t = tokens(selector);
      const background = t["--background"] ?? "";
      for (const column of COLUMNS) {
        const tone = t[`--column-${column}`] ?? "";
        expect(`${selector} ${column}: ${tone}`).toMatch(/oklch\(/);
        expect(`${selector} ${column} line: ${contrastRatio(tone, background) >= 3}`).toBe(
          `${selector} ${column} line: true`,
        );
        const tint = tinted(tone, background);
        for (const text of ["--foreground", "--muted-foreground"]) {
          const ratio = contrastRatio(t[text] ?? "", tint);
          expect(`${selector} ${column} ${text}: ${ratio >= 4.5}`).toBe(
            `${selector} ${column} ${text}: true`,
          );
        }
      }
    }
  });

  test("a column is a thin top border over a faint tint of its own tone", () => {
    const rule = /\.board-column\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("border-top");
    expect(rule).toContain("color-mix");
    // In oklab, which has no hue to travel: in oklch a near-white background and an amber tone mixed
    // through a pink.
    expect(rule).toContain("color-mix(in oklab,");
    for (const column of COLUMNS) {
      expect(css).toContain(`--column-tone: var(--column-${column})`);
    }
  });
});
