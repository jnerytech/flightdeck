/**
 * Issue #1949: the git-based metrics of a release snapshot. Pure: they read the text of `git log`
 * and the line counts they are given, never git itself.
 */

export interface LogCommit {
  hash: string;
  date: string;
  subject: string;
  files: string[];
}

export interface Hotspot {
  path: string;
  commits: number;
  lines: number;
  score: number;
}

export interface CoupledPair {
  a: string;
  b: string;
  commits: number;
}

/** The commits of `git log --format=%x1e%H%x1f%cI%x1f%s --name-only`. */
export function parseLog(_text: string): LogCommit[] {
  return [];
}

/** Whether a path is a source file the metrics count (tests, declarations and the vendored UI are not). */
export function isSource(_path: string): boolean {
  return true;
}

/** The files by commits touching them, most first; ties by path. */
export function changeCounts(_commits: LogCommit[]): Array<{ path: string; commits: number }> {
  return [];
}

/** Ranks files by commits times lines, the top `limit`. */
export function hotspots(
  _counts: Array<{ path: string; commits: number }>,
  _lines: Map<string, number>,
  _limit: number,
): Hotspot[] {
  return [];
}

/** The file pairs most often in the same commit: at least `minSupport` commits, bulk commits skipped. */
export function coupling(
  _commits: LogCommit[],
  _opts: { minSupport: number; maxFiles: number; limit: number },
): CoupledPair[] {
  return [];
}
