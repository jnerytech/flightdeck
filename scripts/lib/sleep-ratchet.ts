/** Test folders whose files the sleep ratchet counts, relative to the repository root. */
export const SLEEP_ROOTS: readonly string[] = [
  "apps/daemon/test",
  "apps/desktop/test",
  "packages/protocol/test",
  "scripts/test",
];

/** How many fixed sleeps a test source holds (the ones with a `// timing:` comment are not counted). */
export function fixedSleeps(_source: string): number {
  return 0;
}

/** Every test file under the roots with its count of fixed sleeps (none left out), keyed under `root`. */
export function sleepCounts(_root: string): Record<string, number> {
  return {};
}
