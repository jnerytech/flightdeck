/**
 * Issue #1949 (task 2): the whole-repo coverage of a snapshot. CI keeps the totals of its merged
 * lcov in `coverage-summary.json` (90 days, the lcov artifact itself lives 1 day); a snapshot reads
 * the one of the latest full green run on the tag's commit.
 */

import { isCoverageSource, parseLcov } from "../coverage-check.ts";

export interface CoverageSummary {
  linesPercent: number | null;
  functionsPercent: number | null;
  lines: { hit: number; found: number };
  functions: { hit: number; found: number };
}

const percent = (hit: number, found: number) => (found === 0 ? null : (hit / found) * 100);

/** The totals of an lcov report over the files the coverage gate covers. */
export function coverageSummary(lcov: string): CoverageSummary {
  const lines = { hit: 0, found: 0 };
  const functions = { hit: 0, found: 0 };
  for (const [path, file] of parseLcov(lcov)) {
    if (!isCoverageSource(path)) continue;
    lines.hit += file.lines[0];
    lines.found += file.lines[1];
    functions.hit += file.functions[0];
    functions.found += file.functions[1];
  }
  return {
    linesPercent: percent(lines.hit, lines.found),
    functionsPercent: percent(functions.hit, functions.found),
    lines,
    functions,
  };
}

const isCount = (v: unknown): v is { hit: number; found: number } =>
  v !== null &&
  typeof v === "object" &&
  typeof (v as { hit?: unknown }).hit === "number" &&
  typeof (v as { found?: unknown }).found === "number";
const isPercent = (v: unknown) => v === null || typeof v === "number";

/** The summary file's text as a summary, or null when it is not one. */
export function parseCoverageSummary(text: string): CoverageSummary | null {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  if (!isPercent(value.linesPercent) || !isPercent(value.functionsPercent)) return null;
  if (!isCount(value.lines) || !isCount(value.functions)) return null;
  return {
    linesPercent: value.linesPercent as number | null,
    functionsPercent: value.functionsPercent as number | null,
    lines: { hit: value.lines.hit, found: value.lines.found },
    functions: { hit: value.functions.hit, found: value.functions.found },
  };
}

interface RunRef {
  databaseId: number;
  event: string;
  createdAt: string;
}

const FULL_EVENTS = new Set(["schedule", "workflow_dispatch"]);

/** The latest full run (a schedule or a dispatch: the pull requests and pushes run a selection), or null. */
export function latestFullRun(runs: RunRef[]): number | null {
  const full = runs
    .filter((run) => FULL_EVENTS.has(run.event))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return full[0]?.databaseId ?? null;
}
