/**
 * Issue #1610: the flat tests of a workspace, counted. CLAUDE.md "Structure" wants tests in domain
 * folders (`test/<domain>/<name>.test.ts`); a test file directly in `<workspace>/test/` is still
 * flat. test-layout-baseline.json holds the count per workspace and only goes down.
 */

/** How many flat test files each workspace's `test/` folder holds (workspaces with none left out). */
export function flatTestCounts(_paths: string[]): Record<string, number> {
  return { stub: -1 };
}
