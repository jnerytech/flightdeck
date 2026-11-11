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

export interface Spread {
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

/** The nearest-rank percentile of the values; null for none. */
export function percentile(_values: number[], _p: number): number | null {
  return -1;
}

/** Duration, queue time and rerun rate of the PR runs created in the window. */
export function ciHealth(_runs: CiRun[], _window: TimeWindow): CiHealth {
  return {
    runs: -1,
    durationSeconds: { p50: -1, p90: -1 },
    queueSeconds: { p50: -1, p90: -1 },
    rerunRate: -1,
  };
}

/** The red periods of main that start in the window: from the first failed run to the next successful one. */
export function mainRed(_runs: CiRun[], _window: TimeWindow): MainRed {
  return { periods: -1, totalSeconds: -1 };
}

/** Changed lines per merged PR, and the rework share of the commits, in the window. */
export function prSize(_prs: MergedPr[], _commits: LogCommit[], _window: TimeWindow): PrSize {
  return { merged: -1, changedLines: { p50: -1, p90: -1 }, reworkShare: -1 };
}
