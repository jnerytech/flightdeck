/** The coverage rule of `test:related`: every changed source file is 100% covered by the related tests. */

/** Whether a repository path is a source file the 100% rule covers (as in the full suite). */
export function isCoverageSource(_path: string): boolean {
  return false;
}

/** The changed files the rule covers: sources with runtime code that still exist. */
export function coverageTargets(
  _changed: readonly string[],
  _read: (path: string) => string | null,
): string[] {
  return [];
}

/** `1, 2, 3, 5` as `1-3, 5`. */
export function lineRanges(_lines: readonly number[]): string {
  return "";
}

export interface CoverageVerdict {
  /** One line per target below 100%, naming the uncovered lines. */
  problems: string[];
  /** The targets whose functions are not all called: the ones `coverage:funcs` can name. */
  functionGaps: string[];
}

/** Checks the targets against an lcov report; other files in the report are ignored. */
export function checkChanged(_lcov: string, _targets: readonly string[]): CoverageVerdict {
  return { problems: [], functionGaps: [] };
}
