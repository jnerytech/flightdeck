import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contrastRatio } from "../src/lib/contrast.ts";
import { HOST_COLORS, hostColorIndex, hostColorVar } from "../src/lib/host-color.ts";

const css = readFileSync(resolve(import.meta.dir, "../src/styles.css"), "utf8");

/** `--name: value;` declarations of the first `selector { … }` block of styles.css. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1] as string, m[2] as string]),
  );
}

/** The body of a named style of styles.css, or "" when there is none. */
function utility(name: string): string {
  const start = css.indexOf(`@utility ${name} {`);
  if (start < 0) return "";
  return css.slice(start, css.indexOf("\n}\n", start));
}

// Issue #644: a host has a color, the same everywhere it shows, readable in both themes.
describe("host-color: a stable color for each host, from eight theme tokens", () => {
  test("the same id gets the same color, always one of the eight", () => {
    for (const id of ["demo-alfa", "ha", "wsl - A", "10.0.0.5", ""]) {
      const index = hostColorIndex(id);
      expect(hostColorIndex(id)).toBe(index);
      expect(Number.isInteger(index) && index >= 0 && index < HOST_COLORS).toBe(true);
      expect(hostColorVar(id)).toBe(`var(--host-${index + 1})`);
    }
  });

  test("the ids spread over all eight colors, and two neighbors are not forced to share one", () => {
    const ids = Array.from({ length: 400 }, (_, i) => `host-${i}`);
    expect(new Set(ids.map(hostColorIndex)).size).toBe(HOST_COLORS);
    expect(new Set(["alfa", "beta", "gama", "delta"].map(hostColorIndex)).size).toBeGreaterThan(1);
  });

  test("every token reads at 3:1 on each surface a host color sits on, in both themes", () => {
    for (const selector of [":root", ".dark"]) {
      const t = tokens(selector);
      for (let n = 1; n <= HOST_COLORS; n++) {
        const color = t[`--host-${n}`] ?? "";
        expect(`${selector} --host-${n}: ${color}`).toMatch(/oklch\(/);
        for (const surface of ["--background", "--surface-1", "--popover", "--sidebar"]) {
          const ratio = contrastRatio(color, t[surface] ?? "");
          expect(`${selector} --host-${n} on ${surface}: ${ratio >= 3}`).toBe(
            `${selector} --host-${n} on ${surface}: true`,
          );
        }
      }
    }
  });

  test("a host's tab has a 2 px line on top in its color, and the selected one keeps it", () => {
    const item = utility("tab-item");
    expect(item).toContain("&[data-host]");
    expect(item).toContain("box-shadow: inset 0 2px 0 var(--host-color);");
    const selected = item.slice(item.indexOf('&:has([role="tab"][aria-selected="true"])'));
    expect(selected).toContain("background: var(--host-color, var(--color-primary));");
  });
});
