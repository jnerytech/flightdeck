import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  renderBaseline,
  SYNC_BASELINE,
  syncCallCount,
  syncCounts,
  withBaseline,
} from "../lib/no-sync-ratchet.ts";

const root = resolve(import.meta.dir, "../..");

describe("no-sync: runtime code does not block on IO", () => {
  test("counts fs, child_process and Bun blocking calls, and nothing else", () => {
    const source = [
      "import {",
      "  existsSync,",
      "  readFileSync,",
      '} from "node:fs";',
      "const a = readFileSync(path, 'utf8');",
      "const b = fs.statSync(path);",
      "const c = Bun.spawnSync(['git']);",
      "const d = execSync('ls');",
      "const e = existsSync (path);",
      "// readFileSync(path) in a comment",
      " * writeFileSync(path) in a doc block",
      "this.startPeersSync();",
      "const f = await readFile(path);",
      "const g = realpathSync.native(path);",
      "const h = { exists: existsSync, read: readFileSync };",
    ].join("\n");
    // Calls, `.native(` calls and bare references count; the import lines do not.
    expect(syncCallCount(source)).toBe(8);
    expect(syncCallCount("")).toBe(0);
  });

  test("the count per file equals the baseline, which only goes down", () => {
    expect(syncCounts(root)).toEqual(SYNC_BASELINE);
  });

  test("the baseline is rendered sorted, one entry per line, and replaced in the module's text", () => {
    const counts = { "apps/daemon/src/b.ts": 2, "apps/daemon/src/a.ts": 1 };
    expect(renderBaseline(counts)).toBe(
      '  "apps/daemon/src/a.ts": 1,\n  "apps/daemon/src/b.ts": 2,',
    );
    const source = [
      "const before = 1;",
      "export const SYNC_BASELINE: Record<string, number> = {",
      '  "old.ts": 9,',
      "};",
      "const after = 2;",
    ].join("\n");
    expect(withBaseline(source, counts)).toBe(
      [
        "const before = 1;",
        "export const SYNC_BASELINE: Record<string, number> = {",
        '  "apps/daemon/src/a.ts": 1,',
        '  "apps/daemon/src/b.ts": 2,',
        "};",
        "const after = 2;",
      ].join("\n"),
    );
    expect(withBaseline(source, {})).toContain("= {\n};");
  });
});
