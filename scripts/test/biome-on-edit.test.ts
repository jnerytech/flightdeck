import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { biomeEditArgs } from "../lib/claude-hooks.ts";
import { realTempDir } from "./temp-dir.ts";

const ROOT = resolve(import.meta.dir, "../..");
const BIOME = join(ROOT, "node_modules", ".bin", "biome");

/**
 * Issue #1566: the biome-on-edit hook took 6 to 13 s per edit. Two rules (noFloatingPromises,
 * useArraySortCompare) need the types of the whole project, so Biome 2 scanned every file before it
 * checked one. The hook leaves those two to `bun run lint`, and keeps every other diagnostic and
 * the formatting.
 */

describe("biome-on-edit: the arguments of the hook's Biome run (#1566)", () => {
  test("it checks and fixes the file it is given, and skips the rules that scan the project", () => {
    const args = biomeEditArgs("scripts/x.ts");
    expect(args.slice(0, 3)).toEqual(["x", "biome", "check"]);
    expect(args).toContain("--write");
    expect(args.at(-1)).toBe("scripts/x.ts");
    expect(args).toContain("--skip=project");
    expect(args).toContain("--skip=types");
  });
});

// Biome's own binary from node_modules/.bin is a shim on Windows; Windows runs no PR checks (#534).
describe.skipIf(process.platform === "win32")("biome-on-edit: what the run reports (#1566)", () => {
  const PLANTED = [
    "async function f() {",
    "  return 1;",
    "}",
    "export function g() {",
    "  f();",
    "  return [3, 1].sort();",
    "}",
    "debugger;",
    "export const z = {a:1}",
    "",
  ].join("\n");

  /** A project with the repo's two type-aware rules on, and `src/a.ts` holding the planted file. */
  function run(args: string[]) {
    const dir = realTempDir("biome-on-edit-");
    try {
      writeFileSync(
        join(dir, "biome.json"),
        [
          "{",
          '  "files": { "includes": ["src/**"] },',
          '  "formatter": { "indentStyle": "space", "lineWidth": 100 },',
          '  "linter": { "rules": { "preset": "recommended",',
          '    "nursery": { "noFloatingPromises": "error" },',
          '    "suspicious": { "useArraySortCompare": "error" } } },',
          '  "javascript": { "formatter": { "quoteStyle": "double" } }',
          "}",
          "",
        ].join("\n"),
      );
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "a.ts"), PLANTED);
      const proc = Bun.spawnSync([BIOME, ...args.slice(2)], { cwd: dir });
      return {
        code: proc.exitCode,
        log: `${proc.stdout.toString()}${proc.stderr.toString()}`,
        after: readFileSync(join(dir, "src", "a.ts"), "utf8"),
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("a planted lint error is reported and a format error is fixed in the file", () => {
    const { code, log, after } = run(biomeEditArgs("src/a.ts"));
    expect(code).toBe(1);
    expect(log).toContain("lint/suspicious/noDebugger");
    expect(after).toContain("export const z = { a: 1 };");
  });

  test("the two rules that scan the whole project are left to bun run lint", () => {
    const { log } = run(biomeEditArgs("src/a.ts"));
    expect(log).not.toContain("noFloatingPromises");
    expect(log).not.toContain("useArraySortCompare");
  });
});
