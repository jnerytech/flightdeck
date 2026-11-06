/**
 * The base of the test pyramid holds (#309): a source file the unit and component tiers alone cover
 * at 100% stays so. `fast-coverage-baseline.json` lists those files and only grows, so coverage
 * never moves quietly from the cheap tiers to the slow ones.
 */

/** The source files an lcov report covers at 100% lines and functions, sorted. */
export function fullyCovered(_lcov: string, _sources: readonly string[]): string[] {
  return [];
}

export interface FastCoverageVerdict {
  /** Listed in the baseline, no longer at 100% from the fast tiers: a failure. */
  dropped: string[];
  /** At 100% now and not listed yet: `--write` adds them. */
  gained: string[];
}

/** The fast tiers' covered files against the baseline. */
export function fastCoverageVerdict(
  _covered: readonly string[],
  _baseline: readonly string[],
): FastCoverageVerdict {
  return { dropped: [], gained: [] };
}
