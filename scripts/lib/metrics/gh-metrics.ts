/**
 * Issue #1949 (task 2): the `gh`-based metrics of a release snapshot, and the rework share. Pure:
 * they read the JSON `gh` printed and the commits of `git log`, never the network.
 */
import type { LogCommit } from "./git-log.ts";

/** A span of time a windowed metric covers; `from` is null for no lower bound. */
export interface TimeWindow {
  from: Date | null;
  to: Date;
}

export interface CiRun {
  createdAt: string;
  startedAt: string;
  updatedAt: string;
  attempt: number;
  status: string;
  conclusion: string;
}

export interface MergedPr {
  additions: number;
  deletions: number;
  mergedAt: string;
}

interface Spread {
  p50: number | null;
  p90: number | null;
}

export interface CiHealth {
  runs: number;
  durationSeconds: Spread;
  queueSeconds: Spread;
  /** The share of runs whose attempt is above 1; null with no runs. */
  rerunRate: number | null;
}

export interface MainRed {
  periods: number;
  totalSeconds: number;
}

export interface PrSize {
  merged: number;
  changedLines: Spread;
  /** The share of `fix` commits made within 48 hours of a `feat` commit that touched one of the same files. */
  reworkShare: number | null;
}

const HOUR_MS = 3_600_000;
/** A `fix` this soon after a `feat` that touched one of its files counts as rework. */
const REWORK_MS = 48 * HOUR_MS;

/** The nearest-rank percentile of the values; null for none. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? null;
}

const spread = (values: number[]): Spread => ({
  p50: percentile(values, 50),
  p90: percentile(values, 90),
});

const within = (when: string, window: TimeWindow) => {
  const t = Date.parse(when);
  return (window.from === null || t >= window.from.getTime()) && t <= window.to.getTime();
};

const seconds = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 1000;

/** Duration, queue time and rerun rate of the PR runs created in the window. */
export function ciHealth(runs: CiRun[], window: TimeWindow): CiHealth {
  const done = runs.filter((r) => r.status === "completed" && within(r.createdAt, window));
  return {
    runs: done.length,
    durationSeconds: spread(done.map((r) => seconds(r.startedAt, r.updatedAt))),
    queueSeconds: spread(done.map((r) => seconds(r.createdAt, r.startedAt))),
    rerunRate: done.length === 0 ? null : done.filter((r) => r.attempt > 1).length / done.length,
  };
}

/** The red periods of main that start in the window: from the first failed run to the next successful one. */
export function mainRed(runs: CiRun[], window: TimeWindow): MainRed {
  const ordered = runs
    .filter((r) => r.status === "completed")
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  let periods = 0;
  let totalSeconds = 0;
  let opened: string | null = null;
  const close = (end: string) => {
    if (opened === null) return;
    if (within(opened, window)) {
      periods++;
      totalSeconds += seconds(opened, end);
    }
    opened = null;
  };
  for (const r of ordered) {
    if (r.conclusion === "failure" && opened === null) opened = r.createdAt;
    else if (r.conclusion === "success") close(r.updatedAt);
  }
  close(window.to.toISOString());
  return { periods, totalSeconds };
}

/** The share of `fix` commits with a `feat` commit up to 48 hours before it that touched one of its files. */
function reworkShare(commits: LogCommit[]): number | null {
  const fixes = commits.filter((c) => /^fix(\(|:|!)/.test(c.subject));
  if (fixes.length === 0) return null;
  const feats = commits.filter((c) => /^feat(\(|:|!)/.test(c.subject));
  const reworked = fixes.filter((fix) => {
    const t = Date.parse(fix.date);
    return feats.some((feat) => {
      const gap = t - Date.parse(feat.date);
      return gap >= 0 && gap <= REWORK_MS && feat.files.some((file) => fix.files.includes(file));
    });
  });
  return reworked.length / fixes.length;
}

/** Changed lines per merged PR, and the rework share of the commits, in the window. */
export function prSize(prs: MergedPr[], commits: LogCommit[], window: TimeWindow): PrSize {
  const merged = prs.filter((pr) => within(pr.mergedAt, window));
  return {
    merged: merged.length,
    changedLines: spread(merged.map((pr) => pr.additions + pr.deletions)),
    reworkShare: reworkShare(commits.filter((c) => within(c.date, window))),
  };
}
