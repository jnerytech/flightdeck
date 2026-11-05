import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Files that are allowed to name the OS temp folder: the one that builds the real-path form, and
 * the cleanup of a run's folders with its own fixture.
 */
export const TEMP_PATH_ALLOWED: readonly string[] = [
  "scripts/test/temp-dir.ts",
  "scripts/test/temp-run.ts",
  "scripts/test/temp-run-fixture.ts",
];

/**
 * The uses of a bare `tmpdir()` or of the JS `realpathSync(` (not `.native`) in a source (issue
 * #262). On a Windows runner TEMP is the 8.3 short form (`C:\Users\RUNNER~1`) while the app shows the
 * long real path, so a test builds its folders with `realTempDir` and resolves with
 * `realpathSync.native`.
 */
export function bareTempUses(source: string): number {
  // Comments name these calls to explain them: they are not uses.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const tmp = code.match(/(?<![\w$])tmpdir\(\)/g)?.length ?? 0;
  const real = code.match(/(?<![\w$.])realpathSync\(/g)?.length ?? 0;
  return tmp + real;
}

/** Bare temp-path uses per test file (files with none left out). */
export function tempPathCounts(root: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "fixtures") walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || entry.name === "temp-path-ratchet.test.ts") continue;
      const name = relative(root, path).replaceAll("\\", "/");
      if (TEMP_PATH_ALLOWED.includes(name)) continue;
      const count = bareTempUses(readFileSync(path, "utf8"));
      if (count > 0) counts[name] = count;
    }
  };
  for (const dir of [
    "apps/daemon/test",
    "apps/desktop/test",
    "packages/protocol/test",
    "scripts/test",
  ]) {
    walk(join(root, dir));
  }
  return counts;
}
