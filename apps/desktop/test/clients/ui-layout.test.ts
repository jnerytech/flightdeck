import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { styleViolations } from "../../../../scripts/lib/styles/style-lint.ts";

/**
 * The client components held to the design tokens; the screens beside them are not. The raw layout
 * utilities are held by `layout/layout-ratchet.test.ts` for every screen (these files have no entry
 * in the baseline, so they may hold none), which is why only the colors and fixed measures are read here.
 */
const files = ["assign-menu.tsx", "client-chip.tsx", "client-dot.tsx", "client-switcher.tsx"];
const DIR = resolve(import.meta.dir, "../../src/features/clients");

describe("clients-ui: the client components stay on the design tokens", () => {
  test("there are components to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files)("%s has no color outside the tokens and no fixed measure in a style", (name) => {
    const source = readFileSync(join(DIR, name), "utf8");
    expect(styleViolations(source).map((v) => `${v.line}:${v.text}`)).toEqual([]);
  });
});
