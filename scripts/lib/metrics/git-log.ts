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

const RS = "\u001e";
const US = "\u001f";

/** The commits of `git log --format=%x1e%H%x1f%cI%x1f%s --name-only`. */
export function parseLog(text: string): LogCommit[] {
  return text
    .split(RS)
    .filter((block) => block.trim() !== "")
    .map((block) => {
      const [head = "", ...rest] = block.split("\n");
      const [hash = "", date = "", subject = ""] = head.split(US);
      return { hash, date, subject, files: rest.filter((line) => line.trim() !== "") };
    });
}

const SOURCE = /\.(ts|tsx|rs)$/;
const TEST = /(^|\/)(test|tests|__tests__)\/|\.(test|spec|e2e)\.tsx?$|\.d\.ts$/;
const VENDORED = "apps/desktop/src/components/ui/";

/** Whether a path is a source file the metrics count (tests, declarations and the vendored UI are not). */
export function isSource(path: string): boolean {
  return SOURCE.test(path) && !TEST.test(path) && !path.startsWith(VENDORED);
}

/** The files by commits touching them, most first; ties by path. */
export function changeCounts(commits: LogCommit[]): Array<{ path: string; commits: number }> {
  const counts = new Map<string, number>();
  for (const { files } of commits) {
    for (const path of new Set(files)) {
      if (isSource(path)) counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([path, n]) => ({ path, commits: n }))
    .sort((a, b) => b.commits - a.commits || a.path.localeCompare(b.path));
}

/** Ranks files by commits times lines, the top `limit`; a file with no line count (gone at the tag) is left out. */
export function hotspots(
  counts: Array<{ path: string; commits: number }>,
  lines: Map<string, number>,
  limit: number,
): Hotspot[] {
  return counts
    .flatMap(({ path, commits }) => {
      const n = lines.get(path);
      return n === undefined ? [] : [{ path, commits, lines: n, score: commits * n }];
    })
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit);
}

/** The file pairs most often in the same commit: at least `minSupport` commits, bulk commits skipped. */
export function coupling(
  commits: LogCommit[],
  opts: { minSupport: number; maxFiles: number; limit: number },
): CoupledPair[] {
  const pairs = new Map<string, number>();
  for (const { files } of commits) {
    if (files.length > opts.maxFiles) continue;
    const sources = [...new Set(files.filter(isSource))].sort((a, b) => a.localeCompare(b));
    for (let i = 0; i < sources.length; i++) {
      for (let j = i + 1; j < sources.length; j++) {
        const key = `${sources[i]}${US}${sources[j]}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }
  return [...pairs]
    .filter(([, n]) => n >= opts.minSupport)
    .map(([key, n]) => {
      const [a = "", b = ""] = key.split(US);
      return { a, b, commits: n };
    })
    .sort((x, y) => y.commits - x.commits || x.a.localeCompare(y.a) || x.b.localeCompare(y.b))
    .slice(0, opts.limit);
}
