/** The coverage rule of `test:related`: every changed source file is 100% covered by the related tests. */

import { ENTRY_POINTS, hasRuntimeCode, isCoverageSource } from "./coverage-check.ts";

export { isCoverageSource };

/** The changed files the rule covers: sources with runtime code that still exist. */
export function coverageTargets(
  changed: readonly string[],
  read: (path: string) => string | null,
): string[] {
  return changed.filter((path) => {
    if (!isCoverageSource(path)) return false;
    const code = read(path);
    return code !== null && hasRuntimeCode(code, path.endsWith(".tsx") ? "tsx" : "ts");
  });
}

/** bunfig.toml's `coveragePathIgnorePatterns`, as one test: the files the full suite's gate skips. */
export const WHOLE_SUITE_IGNORED = /(?:^|\/)(?:test\/|components\/ui\/|scripts\/demo-seed\.ts$)/;

/**
 * #762: of the files a changed test newly loads, the ones the full suite's 100% gate counts. That
 * gate takes every loaded file outside its ignore patterns, not only the sources of
 * `coverageTargets` (a `scripts/` entry file counts once a test imports it).
 */
export function loadedTargets(
  paths: readonly string[],
  read: (path: string) => string | null,
): string[] {
  return paths.filter((path) => {
    // Entry points and declarations are waived as in isCoverageSource (#770 review).
    if (!/\.tsx?$/.test(path) || path.endsWith(".d.ts") || ENTRY_POINTS.has(path)) return false;
    if (WHOLE_SUITE_IGNORED.test(path)) return false;
    const code = read(path);
    return code !== null && hasRuntimeCode(code, path.endsWith(".tsx") ? "tsx" : "ts");
  });
}

/** `1, 2, 3, 5` as `1-3, 5`. */
export function lineRanges(lines: readonly number[]): string {
  const runs: string[] = [];
  for (let i = 0; i < lines.length; ) {
    let end = i;
    while (lines[end + 1] === (lines[end] as number) + 1) end += 1;
    runs.push(end > i ? `${lines[i]}-${lines[end]}` : String(lines[i]));
    i = end + 1;
  }
  return runs.join(", ");
}

export interface CoverageVerdict {
  /** One line per target below 100%, naming the uncovered lines. */
  problems: string[];
  /** The targets whose functions are not all called: the ones `coverage:funcs` can name. */
  functionGaps: string[];
}

interface FileGaps {
  functions: [number, number];
  uncovered: number[];
}

/** Per file: the function totals and the lines with no hit, from an lcov report. */
function readLcov(lcov: string): Map<string, FileGaps> {
  const files = new Map<string, FileGaps>();
  let current: FileGaps | null = null;
  for (const line of lcov.split(/\r?\n/)) {
    const [key, value = ""] = line.split(":", 2) as [string, string?];
    if (key === "SF") {
      current = { functions: [0, 0], uncovered: [] };
      files.set(line.slice(3).replaceAll("\\", "/"), current);
    } else if (current && key === "FNH") current.functions[0] = Number(value);
    else if (current && key === "FNF") current.functions[1] = Number(value);
    else if (current && key === "DA") {
      const [at = "", hits = ""] = line.slice(3).split(",");
      if (Number(hits) === 0) current.uncovered.push(Number(at));
    }
  }
  return files;
}

/** What a file of the report misses ("lines 3-4 not covered; functions 1/2 called"), or "". */
function gapsOf(file: FileGaps): string {
  const gaps: string[] = [];
  if (file.uncovered.length > 0) gaps.push(`lines ${lineRanges(file.uncovered)} not covered`);
  const [hit, found] = file.functions;
  if (hit < found) gaps.push(`functions ${hit}/${found} called`);
  return gaps.join("; ");
}

/** Checks the targets against an lcov report; other files in the report are ignored. */
export function checkChanged(lcov: string, targets: readonly string[]): CoverageVerdict {
  const report = readLcov(lcov);
  const verdict: CoverageVerdict = { problems: [], functionGaps: [] };
  for (const target of targets) {
    const file = report.get(target);
    if (!file) {
      verdict.problems.push(`${target}: no related test loads this file`);
      continue;
    }
    const gaps = gapsOf(file);
    if (file.functions[0] < file.functions[1]) verdict.functionGaps.push(target);
    if (gaps) verdict.problems.push(`${target}: ${gaps}`);
  }
  return verdict;
}

/**
 * #996: every file of a whole-suite lcov report below 100%, with what it misses. Bun's
 * threshold fails such a run with exit code 1 and no word on which file.
 */
export function belowFull(lcov: string): string[] {
  return [...readLcov(lcov)]
    .map(([file, gaps]) => ({ file, gaps: gapsOf(gaps) }))
    .filter(({ gaps }) => gaps !== "")
    .map(({ file, gaps }) => `${file}: ${gaps}`);
}

/** #996: why a whole-suite run exited non-zero, from its lcov report; null when it passed. */
export function wholeSuiteVerdict(code: number, lcov: string | null): string | null {
  if (code === 0) return null;
  const lead = `test:related: the whole suite exited with ${code}`;
  if (lcov === null) return `${lead} and left no coverage report`;
  const below = belowFull(lcov);
  if (below.length === 0) {
    return `${lead} with every file at 100%: a failing test, a file that did not load or the isolation guard stopped it (see above)`;
  }
  return [
    `${lead}, and ${below.length} file(s) are below the 100% gate:`,
    ...below.map((line) => `  - ${line}`),
  ].join("\n");
}

/** #1000 review: removes the whole suite's report before the run; the verdict after it. */
export function wholeSuiteCheck(
  _path: string | undefined,
  _deps: { remove: (path: string) => void; read: (path: string) => string | null },
): (code: number) => string | null {
  return () => null;
}
