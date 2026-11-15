import { describe, expect, test } from "bun:test";
import {
  type Claim,
  claimBody,
  claimOf,
  endedRuns,
  failingOf,
  fullRunRed,
  holder,
  isFullDispatch,
  type MainRun,
  newerDispatches,
  newestGreenAt,
  oneLine,
  plainOwner,
  pushRunOf,
  type RunRow,
  redHeadline,
  redOf,
  warningLine,
} from "../../lib/pr/main-red-rules.ts";

const row = (databaseId: number, conclusion: string, createdAt: string): RunRow => ({
  databaseId,
  conclusion,
  createdAt,
  url: `https://github.com/o/r/actions/runs/${databaseId}`,
});

const run = (over: Partial<MainRun> = {}): MainRun => ({
  id: 1,
  url: "https://github.com/o/r/actions/runs/1",
  createdAt: "2026-11-15T10:00:00Z",
  red: true,
  lastGreenAt: "",
  ...over,
});

const claim = (over: Partial<Claim> = {}): Claim => ({
  number: 7,
  cause: "typecheck",
  owner: "fd-qa",
  failing: [],
  jobs: [],
  runAt: "",
  ...over,
});

describe("main-red rules: text from an issue is data (#1246)", () => {
  test("one line, no control character, cut at the limit", () => {
    expect(oneLine("a\n\tb\u0000c   d", 100)).toBe("a b c d");
    expect(oneLine("abcdef", 3)).toBe("abc");
  });

  test("an owner is a plain session name, else unknown", () => {
    expect(plainOwner("fd-qa")).toBe("fd-qa");
    expect(plainOwner("fd qa; rm")).toBe("unknown");
  });
});

describe("main-red rules: which run says main is red (#1381)", () => {
  test("the push run is read from the latest run that finished green or red", () => {
    const finished = [row(3, "cancelled", "c"), row(2, "failure", "b"), row(1, "success", "a")];
    expect(pushRunOf(finished)).toEqual({
      id: 2,
      url: finished[1]?.url ?? "",
      createdAt: "b",
      red: true,
      lastGreenAt: "a",
    });
    expect(pushRunOf([row(3, "cancelled", "c")])).toBeNull();
  });

  test("a cancelled run says nothing, a timed out one is a red", () => {
    const kept = endedRuns([row(1, "cancelled", "a"), row(2, "timed_out", "b")]);
    expect(kept.map((r) => r.databaseId)).toEqual([2]);
  });

  test("the push run makes main red first, then the full run", () => {
    expect(redOf(run({ id: 1 }), run({ id: 2 }))?.id).toBe(1);
    expect(redOf(run({ id: 1, red: false }), run({ id: 2 }))?.id).toBe(2);
    expect(redOf(run({ red: false }), null)).toBeNull();
  });

  test("only the dispatches newer than the latest scheduled run, at most 5, can be the full run", () => {
    const scheduled = [row(1, "success", "2026-11-15T09:00:00Z")];
    const dispatched = Array.from({ length: 7 }, (_, i) =>
      row(10 + i, "success", `2026-11-15T1${i}:00:00Z`),
    );
    expect(newerDispatches(scheduled, dispatched)).toHaveLength(5);
    expect(newerDispatches([row(1, "success", "2026-11-16T00:00:00Z")], dispatched)).toEqual([]);
  });

  test("a dispatch is a full run only when its test suite ran, or its jobs are unread", () => {
    expect(isFullDispatch([{ name: "Test suite (ubuntu)", conclusion: "success" }])).toBe(true);
    expect(isFullDispatch([{ name: "Test suite (ubuntu)", conclusion: "skipped" }])).toBe(false);
    expect(isFullDispatch([{ name: "Screenshots", conclusion: "success" }])).toBe(false);
    expect(isFullDispatch(null)).toBe(true);
  });

  test("a failed full run is red unless only Windows failed; unread jobs leave it red", () => {
    expect(fullRunRed("failure", [{ name: "Test suite (windows)", conclusion: "failure" }])).toBe(
      false,
    );
    expect(fullRunRed("failure", [{ name: "Test suite (ubuntu)", conclusion: "failure" }])).toBe(
      true,
    );
    expect(fullRunRed("failure", null)).toBe(true);
    expect(fullRunRed("timed_out", [])).toBe(true);
  });
});

describe("main-red rules: claims (#1246)", () => {
  test("an issue body reads back as a claim", () => {
    const body = [
      "Cause: typecheck after #1227",
      "Owner: fd-qa",
      "Run at: 2026-11-15T10:00:00Z",
      'Jobs: ["lint","Test suite, shard 1"]',
      "Failing:",
      "- a test",
      "- another",
    ].join("\r\n");
    expect(claimOf({ number: 9, title: "main red: typecheck after #1227", body })).toEqual({
      number: 9,
      cause: "typecheck after #1227",
      owner: "fd-qa",
      failing: ["a test", "another"],
      jobs: ["lint", "Test suite, shard 1"],
      runAt: "2026-11-15T10:00:00Z",
    });
  });

  test("a body that says nothing falls back on the title and an unknown owner", () => {
    expect(claimOf({ number: 3, title: "main red: lint", body: "" })).toEqual({
      number: 3,
      cause: "lint",
      owner: "unknown",
      failing: [],
      jobs: [],
      runAt: "",
    });
  });

  test("the body of a claim is what claimOf reads back", () => {
    const r = run({ createdAt: "2026-11-15T10:00:00Z" });
    const body = claimBody("lint", "fd-qa", r, ["lint"], ["job: lint"]);
    expect(claimOf({ number: 1, title: "main red: lint", body })).toMatchObject({
      cause: "lint",
      owner: "fd-qa",
      failing: ["job: lint"],
      jobs: ["lint"],
      runAt: "2026-11-15T10:00:00Z",
    });
  });

  test("the first claim by number that holds a failing test is the holder", () => {
    const claims = [
      claim({ number: 9, failing: ["a"] }),
      claim({ number: 4, failing: ["a", "b"] }),
      claim({ number: 2, failing: ["z"] }),
    ];
    expect(holder(claims, ["a"])?.number).toBe(4);
    expect(holder(claims, ["a"], 4)?.number).toBe(9);
    expect(holder(claims, ["q"])).toBeUndefined();
  });
});

describe("main-red rules: what a failed run prints (#534)", () => {
  test("the failing tests come from the (fail) lines, Windows left out, once each", () => {
    const log = [
      "Test suite (ubuntu)\tx\t(fail) a test [1.20ms]",
      "Test suite (ubuntu)\tx\t(fail) a test [1.20ms]",
      "Test suite (windows)\tx\t(fail) windows only [5ms]",
    ].join("\n");
    expect(failingOf(log, ["lint"])).toEqual(["a test"]);
  });

  test("with no (fail) line the failed jobs stand in", () => {
    expect(failingOf("", ["lint"])).toEqual(["job: lint"]);
  });

  test("a claim covers a red whose jobs it names, or whose jobs nobody can name", () => {
    const r = run({ full: false });
    expect(warningLine(r, [claim({ jobs: ["lint"] })], ["lint"], 0)).toBe(
      `main is red since ${r.url}: claimed in #7 by fd-qa ("typecheck"); do not start a parallel fix`,
    );
    expect(warningLine(r, [claim({ jobs: ["lint"] })], ["typecheck"], 0)).toBe(
      `main is red since ${r.url}, unclaimed: bun run main-red -- claim "<cause>" before fixing it`,
    );
    expect(warningLine(r, [], [], 0)).toContain("unclaimed");
  });

  test("a full run's headline carries its age and the green push run", () => {
    const full = run({ full: true, createdAt: "2026-11-15T10:00:00Z" });
    const push = run({ id: 2, red: false, url: "https://github.com/o/r/actions/runs/2" });
    expect(redHeadline(full, push, Date.parse("2026-11-15T12:05:00Z"))).toBe(
      `main is red: ${full.url} (full run, 2h 5m old; the push run is green: ${push.url})`,
    );
    expect(redHeadline(push, null, 0)).toBe(`main is red: ${push.url}`);
  });

  test("the newest green start decides which claims close", () => {
    expect(newestGreenAt(run({ createdAt: "b" }), run({ createdAt: "c" }))).toBe("c");
    expect(newestGreenAt(null, null)).toBe("");
  });
});
