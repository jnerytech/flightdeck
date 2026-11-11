import { describe, expect, test } from "bun:test";
import {
  type CiRun,
  ciHealth,
  type MergedPr,
  mainRed,
  percentile,
  prSize,
} from "../../lib/metrics/gh-metrics.ts";
import type { LogCommit } from "../../lib/metrics/git-log.ts";

/** Issue #1949 (task 2): the gh-based metrics, over fixtures; nothing reaches GitHub. */

const at = (iso: string) => new Date(iso);
const WINDOW = { from: at("2026-10-16T00:00:00Z"), to: at("2026-11-15T00:00:00Z") };

/** A run created at `created`, started `queue` s later, finished `duration` s after that. */
function run(created: string, queue: number, duration: number, over: Partial<CiRun> = {}): CiRun {
  const start = new Date(Date.parse(created) + queue * 1000);
  const end = new Date(start.getTime() + duration * 1000);
  return {
    createdAt: created,
    startedAt: start.toISOString(),
    updatedAt: end.toISOString(),
    attempt: 1,
    status: "completed",
    conclusion: "success",
    ...over,
  };
}

describe("metrics: percentile", () => {
  test("it is the nearest rank of the sorted values, and null for none", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([7], 90)).toBe(7);
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 50)).toBe(50);
    expect(percentile([100, 10, 90, 20, 80, 30, 70, 40, 60, 50], 90)).toBe(90);
  });
});

describe("metrics: CI health", () => {
  test("duration and queue time p50 and p90, and the rerun rate, over the runs of the window", () => {
    const runs = [
      run("2026-11-01T10:00:00Z", 10, 600),
      run("2026-11-02T10:00:00Z", 20, 700),
      run("2026-11-03T10:00:00Z", 30, 800, { attempt: 2 }),
      run("2026-11-04T10:00:00Z", 40, 900),
      run("2026-09-01T10:00:00Z", 5, 5000),
    ];
    expect(ciHealth(runs, WINDOW)).toEqual({
      runs: 4,
      durationSeconds: { p50: 700, p90: 900 },
      queueSeconds: { p50: 20, p90: 40 },
      rerunRate: 0.25,
    });
  });

  test("a run still going is not counted, and no runs is null, never zero", () => {
    const going = run("2026-11-01T10:00:00Z", 1, 1, { status: "in_progress", conclusion: "" });
    expect(ciHealth([going], WINDOW)).toEqual({
      runs: 0,
      durationSeconds: { p50: null, p90: null },
      queueSeconds: { p50: null, p90: null },
      rerunRate: null,
    });
  });
});

describe("metrics: CI health, runs that do not count", () => {
  test("a cancelled or skipped run is left out, and a rerun's queue time is not the gap between attempts", () => {
    const runs = [
      run("2026-11-01T10:00:00Z", 10, 600),
      run("2026-11-02T10:00:00Z", 0, 30, { conclusion: "cancelled" }),
      run("2026-11-03T10:00:00Z", 0, 30, { conclusion: "skipped" }),
      // A rerun hours later: createdAt is the first attempt's, startedAt the second's.
      run("2026-11-04T10:00:00Z", 7200, 800, { attempt: 2 }),
    ];
    expect(ciHealth(runs, WINDOW)).toEqual({
      runs: 2,
      durationSeconds: { p50: 600, p90: 800 },
      queueSeconds: { p50: 10, p90: 10 },
      rerunRate: 0.5,
    });
  });
});

describe("metrics: main red", () => {
  test("a period runs from the first failed run to the next successful one", () => {
    const runs = [
      run("2026-11-01T10:00:00Z", 0, 600, { conclusion: "success" }),
      run("2026-11-02T10:00:00Z", 0, 600, { conclusion: "failure" }),
      run("2026-11-02T11:00:00Z", 0, 600, { conclusion: "failure" }),
      run("2026-11-02T12:00:00Z", 0, 600, { conclusion: "success" }),
    ];
    // From the 2nd 10:00 (the first failure) to the 2nd 12:10 (the green run's end): 2 h 10 min.
    expect(mainRed(runs, WINDOW)).toEqual({ periods: 1, totalSeconds: 7800 });
  });

  test("a period still open at the end of the window counts to that end", () => {
    const runs = [run("2026-11-14T00:00:00Z", 0, 600, { conclusion: "failure" })];
    expect(mainRed(runs, WINDOW)).toEqual({ periods: 1, totalSeconds: 86_400 });
  });

  test("a period that is still open at the tag counts to the tag, whatever came after it", () => {
    const runs = [
      run("2026-11-14T00:00:00Z", 0, 600, { conclusion: "failure" }),
      // Green only after the tag (the window ends on the 15th): it does not extend the period.
      run("2026-11-20T00:00:00Z", 0, 600, { conclusion: "success" }),
    ];
    expect(mainRed(runs, WINDOW)).toEqual({ periods: 1, totalSeconds: 86_400 });
  });

  test("runs given newest first are read in time order, and a cancelled run neither opens nor closes a period", () => {
    const runs = [
      run("2026-11-02T12:00:00Z", 0, 600, { conclusion: "success" }),
      run("2026-11-02T11:30:00Z", 0, 60, { conclusion: "cancelled" }),
      run("2026-11-02T10:00:00Z", 0, 600, { conclusion: "failure" }),
    ];
    expect(mainRed(runs, WINDOW)).toEqual({ periods: 1, totalSeconds: 7800 });
    expect(mainRed([], WINDOW)).toEqual({ periods: 0, totalSeconds: 0 });
  });
});

describe("metrics: PR size and rework", () => {
  const prs: MergedPr[] = [
    { additions: 10, deletions: 0, mergedAt: "2026-11-01T00:00:00Z" },
    { additions: 50, deletions: 50, mergedAt: "2026-11-02T00:00:00Z" },
    { additions: 5, deletions: 5, mergedAt: "2026-11-03T00:00:00Z" },
    { additions: 900, deletions: 100, mergedAt: "2026-08-03T00:00:00Z" },
  ];
  const commit = (hash: string, date: string, subject: string, files: string[]): LogCommit => ({
    hash,
    date,
    subject,
    files,
  });

  test("changed lines per merged PR p50 and p90 over the PRs merged in the window", () => {
    const size = prSize(prs, [], WINDOW);
    expect([size.merged, size.changedLines]).toEqual([3, { p50: 10, p90: 100 }]);
    expect(size.reworkShare).toBeNull();
  });

  test("a fix within 48 hours of a feat on the same file counts; one 60 hours later does not", () => {
    const feat = commit("f", "2026-11-01T00:00:00Z", "feat(x): one", ["a.ts"]);
    const soon = commit("s", "2026-11-02T06:00:00Z", "fix(x): soon", ["a.ts"]);
    const late = commit("l", "2026-11-03T12:00:00Z", "fix(x): late", ["a.ts"]);
    const other = commit("o", "2026-11-02T00:00:00Z", "fix(x): elsewhere", ["z.ts"]);
    expect(prSize(prs, [feat, soon], WINDOW).reworkShare).toBe(1);
    expect(prSize(prs, [feat, late], WINDOW).reworkShare).toBe(0);
    expect(prSize(prs, [feat, soon, late, other], WINDOW).reworkShare).toBeCloseTo(1 / 3, 5);
  });
});
