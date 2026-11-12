import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkEditedFile } from "../../lib/hooks/claude-hooks.ts";
import { realTempDir } from "../temp-dir.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const BIOME = join(ROOT, "node_modules", ".bin", "biome");

/**
 * Issue #1566: the biome-on-edit hook took 6 to 13 s per edit. `biome check <file>` scans the
 * whole project first, 3 to 13 s, whatever the rules. The hook now fixes the file through stdin
 * (formatting, import order and safe fixes, which does not scan) and reads what is left with
 * `biome lint`, skipping the two type-aware rules (noFloatingPromises, useArraySortCompare) that
 * need the scan; `bun run lint` still runs them.
 */

// Biome's own binary from node_modules/.bin is a shim on Windows; Windows runs no PR checks (#534).
describe.skipIf(process.platform === "win32")("biome-on-edit: what the hook finds (#1566)", () => {
  const CONFIG = [
    "{",
    '  "files": { "includes": ["src/**"] },',
    '  "formatter": { "indentStyle": "space", "lineWidth": 100 },',
    '  "linter": { "rules": { "preset": "recommended",',
    '    "nursery": { "noFloatingPromises": "error" },',
    '    "suspicious": { "useArraySortCompare": "error" } } },',
    '  "javascript": { "formatter": { "quoteStyle": "double" } }',
    "}",
    "",
  ].join("\n");

  /** A project with the repo's two type-aware rules on and `src/<name>` holding `text`. */
  function check(text: string, name = "a.ts") {
    const dir = realTempDir("biome-on-edit-");
    try {
      writeFileSync(join(dir, "biome.json"), CONFIG);
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "y.ts"), "export const a = 1;\nexport const b = 2;\n");
      writeFileSync(join(dir, "src", name), text);
      const result = checkEditedFile(dir, `src/${name}`, [BIOME]);
      return { ...result, after: readFileSync(join(dir, "src", name), "utf8") };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // CI ran the first test of this file at 7 to 8 s, past the 5 s limit, while the next took a
  // quarter second: Biome's binary starting cold under the suite's load. One run here pays that
  // start outside any test's time (the slow-test check reads each test's own time).
  beforeAll(() => {
    check("export const warm = 1;\n");
  });

  test("formatting and the import order are written into the file, and nothing is left to report", () => {
    const { ok, output, after } = check(
      'import { b, a } from "./y.ts";\nexport const z = {a, b}\n',
    );
    expect(after).toBe('import { a, b } from "./y.ts";\nexport const z = { a, b };\n');
    expect(ok).toBe(true);
    expect(output).toBe("");
  });

  test("a planted lint error is reported, the format error beside it is fixed", () => {
    const { ok, output, after } = check("debugger;\nexport const z = {a:1}\n");
    expect(ok).toBe(false);
    expect(output).toContain("lint/suspicious/noDebugger");
    expect(after).toBe("debugger;\nexport const z = { a: 1 };\n");
  });

  test("a file that does not parse is reported and left as it was", () => {
    const { ok, output, after } = check("export const = ;\n");
    expect(ok).toBe(false);
    expect(output).toContain("parse");
    expect(after).toBe("export const = ;\n");
  });

  test("the two rules that scan the whole project are left to bun run lint", () => {
    const text =
      "async function f() {\n  return 1;\n}\nexport function g() {\n  f();\n  return [3, 1].sort();\n}\n";
    const { ok, output } = check(text);
    expect(ok).toBe(true);
    expect(output).not.toContain("noFloatingPromises");
    expect(output).not.toContain("useArraySortCompare");
  });

  test("a path that starts with a dash is a file, not a Biome option", () => {
    const dir = realTempDir("biome-on-edit-");
    try {
      writeFileSync(join(dir, "biome.json"), CONFIG.replace('["src/**"]', '["**"]'));
      writeFileSync(join(dir, "--verbose.ts"), "debugger;\n");
      const { ok, output } = checkEditedFile(dir, "--verbose.ts", [BIOME]);
      expect(ok).toBe(false);
      expect(output).toContain("lint/suspicious/noDebugger");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a file that is gone is nothing to report", () => {
    const dir = realTempDir("biome-on-edit-");
    try {
      writeFileSync(join(dir, "biome.json"), CONFIG);
      let result: unknown = null;
      try {
        result = checkEditedFile(dir, "src/gone.ts", [BIOME]);
      } catch {
        result = "threw";
      }
      expect(result).toEqual({ ok: true, output: "" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a symlink is not written through: its target keeps its text", () => {
    const dir = realTempDir("biome-on-edit-");
    const outside = realTempDir("biome-on-edit-out-");
    try {
      writeFileSync(join(dir, "biome.json"), CONFIG);
      mkdirSync(join(dir, "src"));
      writeFileSync(join(outside, "t.ts"), "export const z = {a:1}\n");
      symlinkSync(join(outside, "t.ts"), join(dir, "src", "link.ts"));
      checkEditedFile(dir, "src/link.ts", [BIOME]);
      expect(readFileSync(join(outside, "t.ts"), "utf8")).toBe("export const z = {a:1}\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
