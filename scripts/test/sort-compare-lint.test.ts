import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * #322: Biome's useArraySortCompare catches a .sort() or .toSorted() with no compare function in the
 * code before CI does (SonarCloud S2871 failed three PRs in one night). Tests are left out: Sonar
 * does not judge them, and they sort freely.
 */
const ROOT = resolve(import.meta.dir, "../..");

async function lint(files: Record<string, string>) {
  for (const [path, code] of Object.entries(files)) {
    mkdirSync(dirname(resolve(ROOT, path)), { recursive: true });
    writeFileSync(resolve(ROOT, path), code);
  }
  try {
    const proc = Bun.spawn([process.execPath, "x", "biome", "lint", ...Object.keys(files)], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const lines = (out + err).replaceAll("\\", "/").split("\n");
    const flagged = (path: string) =>
      lines.some((line) => line.startsWith(`${path}:`) && line.includes("useArraySortCompare"));
    return { code, flagged };
  } finally {
    for (const path of Object.keys(files)) rmSync(resolve(ROOT, path), { force: true });
  }
}

describe("sort-compare-lint (#322)", () => {
  test("a sort with no compare function fails lint in the code; with one, or in a test, it passes", async () => {
    const bare = "apps/daemon/src/__sort_probe_bare__.ts";
    const sorted = "apps/daemon/src/__sort_probe_sorted__.ts";
    const inTest = "apps/daemon/test/__sort_probe__.test.ts";
    const result = await lint({
      [bare]: 'export const a = ["b", "a"].sort();\nexport const b = ["b", "a"].toSorted();\n',
      [sorted]: 'export const a = ["b", "a"].sort((x, y) => (x < y ? -1 : 1));\n',
      [inTest]: 'export const a = ["b", "a"].sort();\n',
    });
    expect(result.code).not.toBe(0);
    expect(result.flagged(bare)).toBe(true);
    expect(result.flagged(sorted)).toBe(false);
    expect(result.flagged(inTest)).toBe(false);
  });
});
