import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { SYNC_BASELINE, syncCallCount } from "../lib/no-sync-ratchet.ts";

const root = resolve(import.meta.dir, "../..");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name))
      : /\.tsx?$/.test(entry.name)
        ? [join(dir, entry.name)]
        : [],
  );
}

describe("no-sync: runtime code does not block on IO", () => {
  test("counts fs, child_process and Bun blocking calls, and nothing else", () => {
    const source = [
      'import { readFileSync } from "node:fs";',
      "const a = readFileSync(path, 'utf8');",
      "const b = fs.statSync(path);",
      "const c = Bun.spawnSync(['git']);",
      "const d = execSync('ls');",
      "const e = existsSync (path);",
      "// readFileSync(path) in a comment",
      " * writeFileSync(path) in a doc block",
      "this.startPeersSync();",
      "const f = await readFile(path);",
    ].join("\n");
    expect(syncCallCount(source)).toBe(5);
    expect(syncCallCount("")).toBe(0);
  });

  test("the count per file equals the baseline, which only goes down", () => {
    const counts: Record<string, number> = {};
    for (const dir of ["apps/daemon/src", "apps/desktop/src"]) {
      for (const file of sources(join(root, dir))) {
        const count = syncCallCount(readFileSync(file, "utf8"));
        if (count > 0) counts[relative(root, file).replaceAll("\\", "/")] = count;
      }
    }
    expect(counts).toEqual(SYNC_BASELINE);
  });
});
