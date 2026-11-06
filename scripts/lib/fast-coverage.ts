/**
 * The base of the test pyramid holds (#309): a source file the unit and component tiers alone cover
 * at 100% stays so. `fast-coverage-baseline.json` lists those files and only grows, so coverage
 * never moves quietly from the cheap tiers to the slow ones.
 */
import { byCodeUnit } from "@flightdeck/protocol";
import { parseLcov } from "./coverage-check.ts";

/** The source files an lcov report covers at 100% lines and functions, sorted. */
export function fullyCovered(lcov: string, sources: readonly string[]): string[] {
  const report = parseLcov(lcov);
  return sources
    .filter((path) => {
      const file = report.get(path);
      return (
        file !== undefined &&
        file.functions[0] >= file.functions[1] &&
        file.lines[0] >= file.lines[1]
      );
    })
    .sort(byCodeUnit);
}

export interface FastCoverageVerdict {
  /** Listed in the baseline, no longer at 100% from the fast tiers: a failure. */
  dropped: string[];
  /** At 100% now and not listed yet: `--write` adds them. */
  gained: string[];
  /** Listed, but no longer a source (renamed or deleted): `--write` drops them. */
  gone: string[];
}

/** The fast tiers' covered files against the baseline. */
export function fastCoverageVerdict(
  covered: readonly string[],
  baseline: readonly string[],
  _sources: readonly string[],
): FastCoverageVerdict {
  const now = new Set(covered);
  const listed = new Set(baseline);
  return {
    dropped: baseline.filter((path) => !now.has(path)).sort(byCodeUnit),
    gained: covered.filter((path) => !listed.has(path)).sort(byCodeUnit),
    gone: [],
  };
}
