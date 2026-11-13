/**
 * Issue #1949 (task 2): the `gh`-based metrics of a release snapshot, and the rework share. Pure:
 * they read the JSON `gh` printed and the commits of `git log`, never the network.
 */
import { isSource, type LogCommit } from "./git-log.ts";

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
  /** The pull request's title; a row without it or without `files` falls back to the commits (#2027). */
  title?: string;
  /** The files it changed, as `gh pr list --json files` prints them. */
  files?: { path: string }[];
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
  /** The share of `fix` pull requests merged 1 to 48 hours after a `feat` pull request that changed most of the same source files. */
  reworkShare: number | null;
}

const HOUR_MS = 3_600_000;
/** A `fix` this soon after a `feat` that touched one of its files counts as rework. */
export const REWORK_MS = 48 * HOUR_MS;
/**
 * Closer than this, a fix is the review of its own pull request (its commits come a few minutes
 * apart), not a rework of what was shipped: with every commit counted the share read 83% (#2019).
 */
const SAME_PR_MS = HOUR_MS;

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
  // A cancelled or skipped run says nothing about how long CI takes.
  const done = runs.filter(
    (r) =>
      r.status === "completed" &&
      (r.conclusion === "success" || r.conclusion === "failure") &&
      within(r.createdAt, window),
  );
  return {
    runs: done.length,
    durationSeconds: spread(done.map((r) => seconds(r.startedAt, r.updatedAt))),
    // A rerun keeps its first attempt's createdAt, so only a first attempt has a queue time.
    queueSeconds: spread(
      done.filter((r) => r.attempt === 1).map((r) => seconds(r.createdAt, r.startedAt)),
    ),
    rerunRate: done.length === 0 ? null : done.filter((r) => r.attempt > 1).length / done.length,
  };
}

/** The red periods of main that start in the window: from the first failed run to the next successful one. */
export function mainRed(runs: CiRun[], window: TimeWindow): MainRed {
  const ordered = runs
    .filter((r) => r.status === "completed" && Date.parse(r.createdAt) <= window.to.getTime())
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  let periods = 0;
  let totalSeconds = 0;
  let opened: string | null = null;
  const close = (end: string) => {
    if (opened === null) return;
    if (within(opened, window)) {
      periods++;
      // A period never runs past the end of the window: the tag's date.
      totalSeconds += Math.min(seconds(opened, end), seconds(opened, window.to.toISOString()));
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

type TitledPr = MergedPr & { title: string; files: { path: string }[] };
const isTitled = (pr: MergedPr): pr is TitledPr =>
  typeof pr.title === "string" &&
  Array.isArray(pr.files) &&
  pr.files.every(
    (file) =>
      typeof file === "object" &&
      file !== null &&
      typeof (file as { path?: unknown }).path === "string",
  );

const isFix = (title: string) => /^fix[(:!]/.test(title);
const isFeat = (title: string) => /^feat[(:!]/.test(title);

/**
 * Whether the fix touched half or more of its source files in one of the feats that came 1 to 48
 * hours before it: sharing a file everyone touches is not rework.
 */
function reworks(
  fix: { time: number; files: string[] },
  feats: Array<{ time: number; files: string[] }>,
  minGap: number,
): boolean {
  const mine = fix.files.filter(isSource);
  if (mine.length === 0) return false;
  return feats.some((feat) => {
    const gap = fix.time - feat.time;
    if (gap < minGap || gap > REWORK_MS) return false;
    const shared = mine.filter((file) => feat.files.includes(file)).length;
    return shared * 2 >= mine.length;
  });
}

/**
 * The share of `fix` pull requests merged in the window with a `feat` pull request merged 1 to 48
 * hours before it that touched half or more of its source files (#2027); null with no fix pull
 * request. The feat may be older than the window's start.
 */
function reworkShareOfPrs(prs: TitledPr[], window: TimeWindow): number | null {
  const ofPr = (pr: TitledPr) => ({
    time: Date.parse(pr.mergedAt),
    files: pr.files.map((file) => file.path),
  });
  const fixes = prs.filter((pr) => isFix(pr.title) && within(pr.mergedAt, window));
  if (fixes.length === 0) return null;
  const feats = prs.filter((pr) => isFeat(pr.title)).map(ofPr);
  return fixes.filter((fix) => reworks(ofPr(fix), feats, HOUR_MS)).length / fixes.length;
}

/**
 * The same share over commits, for pull requests whose title or files could not be read: a `fix`
 * commit and the `feat` commits an hour or more before it, since closer is the review of its own
 * pull request (#2019).
 */
function reworkShareOfCommits(commits: LogCommit[]): number | null {
  const fixes = commits.filter((c) => isFix(c.subject));
  if (fixes.length === 0) return null;
  const ofCommit = (c: LogCommit) => ({ time: Date.parse(c.date), files: c.files });
  const feats = commits.filter((c) => isFeat(c.subject)).map(ofCommit);
  return fixes.filter((fix) => reworks(ofCommit(fix), feats, SAME_PR_MS)).length / fixes.length;
}

/**
 * Changed lines per merged PR, and the rework share in the window: of the pull requests, or of the
 * commits when a pull request of the window has no title or files.
 */
export function prSize(prs: MergedPr[], commits: LogCommit[], window: TimeWindow): PrSize {
  const merged = prs.filter((pr) => within(pr.mergedAt, window));
  return {
    merged: merged.length,
    changedLines: spread(merged.map((pr) => pr.additions + pr.deletions)),
    reworkShare: merged.every(isTitled)
      ? reworkShareOfPrs(prs.filter(isTitled), window)
      : reworkShareOfCommits(commits.filter((c) => within(c.date, window))),
  };
}
