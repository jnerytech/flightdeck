import fc from "fast-check";

/** The seed of every property test: a failure reproduces on any machine (issue #1608). */
export const PROPERTY_SEED = 20261112;

/**
 * Checks a property over `runs` generated inputs from the fixed seed. A counterexample is printed
 * with the seed and the path that replays it: copy it into a regular example test.
 */
export function holds<T extends unknown[]>(property: fc.IPropertyWithHooks<T>, runs = 100): void {
  fc.assert(property, { seed: PROPERTY_SEED, numRuns: runs });
}

/** The same for a property whose predicate is async. */
export async function holdsAsync<T extends unknown[]>(
  property: fc.IAsyncPropertyWithHooks<T>,
  runs = 100,
): Promise<void> {
  await fc.assert(property, { seed: PROPERTY_SEED, numRuns: runs });
}
