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
export function bareTempUses(_source: string): number {
  return 0;
}

/** Bare temp-path uses per test file (files with none left out). */
export function tempPathCounts(_root: string): Record<string, number> {
  return { "stub.ts": 1 };
}
