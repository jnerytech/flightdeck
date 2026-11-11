/**
 * Issue #1610: the flat tests of a workspace, counted. CLAUDE.md "Structure" wants tests in domain
 * folders (`test/<domain>/<name>.test.ts`); a test file directly in `<workspace>/test/` is still
 * flat. test-layout-baseline.json holds the count per workspace and only goes down.
 */

const FLAT_TEST = /^((?:apps|packages)\/[^/]+\/test|scripts\/test)\/[^/]+\.test\.tsx?$/;

/** How many flat test files each workspace's `test/` folder holds (workspaces with none left out). */
export function flatTestCounts(paths: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const path of paths) {
    const folder = FLAT_TEST.exec(path)?.[1];
    if (folder) counts[folder] = (counts[folder] ?? 0) + 1;
  }
  return counts;
}
