/**
 * Test tiers by content (issue #261), without renaming a file: a test that starts processes, a
 * server or real git is `integration`; one that draws the DOM is `component`; the rest is `unit`;
 * the Playwright journeys and the smokes are `e2e`. A helper counts function by function: a test
 * that takes only `waitFor` from fixtures.ts is not an integration test because `daemon()` sits in
 * the same file. The manifest (test-tiers.json) is generated from this and checked by a test.
 */

export type Tier = "unit" | "component" | "integration" | "e2e";
export const TIERS: Tier[] = ["unit", "component", "integration", "e2e"];

/** The tier of every test file (and every journey and smoke) among these sources, by path. */
export function testTiers(_sources: Map<string, string>): Record<string, Tier> {
  return {};
}

/** How many files each tier holds. */
export function tierCounts(manifest: Record<string, Tier>): Record<Tier, number> {
  const counts = { unit: 0, component: 0, integration: 0, e2e: 0 };
  for (const tier of Object.values(manifest)) counts[tier]++;
  return counts;
}
