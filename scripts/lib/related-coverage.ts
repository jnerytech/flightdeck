/** The coverage rule of `test:related`: every changed source file is at the gate (80%, #1002) from the related tests. */

import {
  belowGate,
  COVERAGE_GATE,
  ENTRY_POINTS,
  hasRuntimeCode,
  isCoverageSource,
} from "./coverage-check.ts";

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
 * #762: of the files a changed test newly loads, the ones the full suite's coverage gate counts. That
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
  /** One line per target below the gate, naming the uncovered lines. */
  problems: string[];
  /** The targets whose functions are not all called: the ones `coverage:funcs` can name. */
  functionGaps: string[];
}

interface FileGaps {
  functions: [number, number];
  /** [hit, found], from the DA lines. */
  lines: [number, number];
  uncovered: number[];
}

/** Per file: the function totals and the lines with no hit, from an lcov report. */
function readLcov(lcov: string): Map<string, FileGaps> {
  const files = new Map<string, FileGaps>();
  let current: FileGaps | null = null;
  for (const line of lcov.split(/\r?\n/)) {
    const [key, value = ""] = line.split(":", 2) as [string, string?];
    if (key === "SF") {
      current = { functions: [0, 0], lines: [0, 0], uncovered: [] };
      files.set(line.slice(3).replaceAll("\\", "/"), current);
    } else if (current && key === "FNH") current.functions[0] = Number(value);
    else if (current && key === "FNF") current.functions[1] = Number(value);
    else if (current && key === "DA") {
      const [at = "", hits = ""] = line.slice(3).split(",");
      current.lines[1] += 1;
      if (Number(hits) === 0) current.uncovered.push(Number(at));
      else current.lines[0] += 1;
    }
  }
  return files;
}

/**
 * What a file below the gate misses ("lines 3-4 not covered; functions 1/2 called"); "" for a
 * file at the gate, whatever lines it leaves uncovered (#1002).
 */
function gapsOf(file: FileGaps): string {
  if (!belowGate(file.functions) && !belowGate(file.lines)) return "";
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
    if (belowGate(file.functions)) verdict.functionGaps.push(target);
    if (gaps) verdict.problems.push(`${target}: ${gaps}`);
  }
  return verdict;
}

/**
 * #996: every file of a whole-suite lcov report below the gate, with what it misses. Bun's
 * threshold fails such a run with exit code 1 and no word on which file.
 */
export function filesBelowGate(lcov: string): string[] {
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
  const below = filesBelowGate(lcov);
  if (below.length === 0) {
    return `${lead} with every file at the ${COVERAGE_GATE}% gate: a failing test, a file that did not load, the isolation guard or a timeout stopped it (see above)`;
  }
  return [
    `${lead}, and ${below.length} file(s) are below the ${COVERAGE_GATE}% gate:`,
    ...below.map((line) => `  - ${line}`),
  ].join("\n");
}

/** #1000 review: removes the whole suite's report before the run; the verdict after it. */
export function wholeSuiteCheck(
  path: string | undefined,
  deps: { remove: (path: string) => void; read: (path: string) => string | null },
): (code: number) => string | null {
  if (path === undefined) return () => null;
  // A run that dies before Bun writes a report must not be judged by an older one.
  deps.remove(path);
  return (code) => wholeSuiteVerdict(code, deps.read(path));
}
