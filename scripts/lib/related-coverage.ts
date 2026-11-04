/** The coverage rule of `test:related`: every changed source file is 100% covered by the related tests. */

import { hasRuntimeCode, isCoverageSource } from "./coverage-check.ts";

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
    const gaps: string[] = [];
    if (file.uncovered.length > 0) gaps.push(`lines ${lineRanges(file.uncovered)} not covered`);
    const [hit, found] = file.functions;
    if (hit < found) {
      gaps.push(`functions ${hit}/${found} called`);
      verdict.functionGaps.push(target);
    }
    if (gaps.length > 0) verdict.problems.push(`${target}: ${gaps.join("; ")}`);
  }
  return verdict;
}
