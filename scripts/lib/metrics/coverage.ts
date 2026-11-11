/**
 * Issue #1949 (task 2): the whole-repo coverage of a snapshot. CI keeps the totals of its merged
 * lcov in `coverage-summary.json` (90 days, the lcov artifact itself lives 1 day); a snapshot reads
 * the one of the latest full green run on the tag's commit.
 */

export interface CoverageSummary {
  linesPercent: number | null;
  functionsPercent: number | null;
  lines: { hit: number; found: number };
  functions: { hit: number; found: number };
}

/** The totals of an lcov report over the files the coverage gate covers. */
export function coverageSummary(_lcov: string): CoverageSummary {
  return {
    linesPercent: -1,
    functionsPercent: -1,
    lines: { hit: -1, found: -1 },
    functions: { hit: -1, found: -1 },
  };
}

/** The summary file's text as a summary, or null when it is not one. */
export function parseCoverageSummary(_text: string): CoverageSummary | null {
  return {
    linesPercent: -1,
    functionsPercent: -1,
    lines: { hit: -1, found: -1 },
    functions: { hit: -1, found: -1 },
  };
}

export interface RunRef {
  databaseId: number;
  event: string;
  createdAt: string;
}

/** The latest full run (a schedule or a dispatch: the pull requests and pushes run a selection), or null. */
export function latestFullRun(_runs: RunRef[]): number | null {
  return -1;
}
