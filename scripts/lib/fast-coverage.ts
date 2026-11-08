/**
 * The base of the test pyramid holds (#309): a source file the unit and component tiers alone cover
 * at the gate (80% of lines and functions, #1002) stays so. `fast-coverage-baseline.json` lists those files and only grows, so coverage
 * never moves quietly from the cheap tiers to the slow ones.
 */
import { byCodeUnit } from "@flightdeck/protocol";
import { belowGate, parseLcov } from "./coverage-check.ts";

/** The source files an lcov report covers at the gate (80% of lines and functions), sorted. */
export function fullyCovered(lcov: string, sources: readonly string[]): string[] {
  const report = parseLcov(lcov);
  return sources
    .filter((path) => {
      const file = report.get(path);
      return file !== undefined && !belowGate(file.functions) && !belowGate(file.lines);
    })
    .sort(byCodeUnit);
}

export interface FastCoverageVerdict {
  /** Listed in the baseline, no longer at the gate from the fast tiers: a failure. */
  dropped: string[];
  /** At the gate now and not listed yet: `--write` adds them. */
  gained: string[];
  /** Listed, but no longer a source (renamed or deleted): `--write` drops them. */
  gone: string[];
}

/** The fast tiers' covered files against the baseline. */
export function fastCoverageVerdict(
  covered: readonly string[],
  baseline: readonly string[],
  sources: readonly string[],
): FastCoverageVerdict {
  const now = new Set(covered);
  const listed = new Set(baseline);
  const exists = new Set(sources);
  return {
    dropped: baseline.filter((path) => exists.has(path) && !now.has(path)).sort(byCodeUnit),
    gained: covered.filter((path) => !listed.has(path)).sort(byCodeUnit),
    gone: baseline.filter((path) => !exists.has(path)).sort(byCodeUnit),
  };
}
