import { describe, expect, test } from "bun:test";
import { latestFullRun, mainRed, mainRedLine } from "../../lib/pr/main-red.ts";
import { created, fakeGh, GREEN_RUN, issue, LOG, RED_RUN } from "./main-red-setup.ts";

/** #1381: main's full runs (the schedule and a dispatch with only=all), which push runs are not. */
const NOW = Date.parse("2026-11-09T03:05:00Z");
/** How a person clears a full run's red once it is fixed: a newer full run. */
const RERUN = "gh workflow run CI --ref main -f only=all";
const FULL_RED = {
  databaseId: 50,
  conclusion: "failure",
  createdAt: "2026-11-09T01:00:00Z",
  url: "https://github.com/o/r/actions/runs/50",
};
const FULL_GREEN = {
  ...FULL_RED,
  databaseId: 51,
  conclusion: "success",
  url: "https://github.com/o/r/actions/runs/51",
};
const SUITE_FAILED = [
  { name: "test suite (ubuntu-latest)", conclusion: "failure" },
  { name: "test suite (windows-latest)", conclusion: "failure" },
];
const SUITE_GREEN = [
  { name: "test suite (ubuntu-latest)", conclusion: "success" },
  { name: "test suite (windows-latest)", conclusion: "failure" },
];
const FULL_LOG = [
  "test suite (ubuntu-latest)\tRun tests\t2026-11-09T01:20:00Z (fail) deps-gate > startCard is the only door [1.20ms]",
  "test suite (windows-latest)\tRun tests\t2026-11-09T01:20:00Z (fail) windows only > a path [3.00ms]",
].join("\n");

function runAt(args: string[], fake: ReturnType<typeof fakeGh>) {
  const lines: string[] = [];
  return {
    lines,
    code: mainRed(args, {
      gh: fake.gh,
      log: (l) => lines.push(l),
      owner: "fd-harness",
      now: () => NOW,
    }),
  };
}

describe("main-red: a red only main's full runs see is reported too (#1381)", () => {
  test("a green push run and a red full run: red, with the full run's failing tests and age", async () => {
    const fake = fakeGh({
      runs: [GREEN_RUN],
      schedule: [FULL_RED],
      jobsById: { 50: SUITE_FAILED },
      logById: { 50: FULL_LOG },
    });
    const shown = runAt([], fake);
    expect(await shown.code).toBe(1);
    expect(shown.lines).toEqual([
      `main is red: ${FULL_RED.url} (full run, 2h 5m old; the push run is green: ${GREEN_RUN.url})`,
      "failing: deps-gate > startCard is the only door",
      `fixed since? a newer full run clears it: ${RERUN}`,
      'unclaimed: bun run main-red -- claim "<cause>"',
    ]);
  });

  test("a green push run and a green full run: green, and the claims close", async () => {
    const fake = fakeGh({
      runs: [GREEN_RUN],
      schedule: [FULL_GREEN],
      jobsById: { 51: SUITE_GREEN },
      claims: [issue(30, "fd-qa", ["x"])],
    });
    const shown = runAt([], fake);
    expect(await shown.code).toBe(0);
    expect(shown.lines).toEqual([`main is green: ${GREEN_RUN.url}`, "closed: #30 (fd-qa)"]);
  });

  test("a full run red only on Windows is green", async () => {
    const windowsOnly = fakeGh({
      runs: [GREEN_RUN],
      schedule: [FULL_RED],
      jobsById: { 50: SUITE_GREEN },
    });
    expect(await runAt([], windowsOnly).code).toBe(0);
  });

  test("a screenshots dispatch, whose test suite job is skipped, is no full run; a newer full dispatch is", async () => {
    const shots = { ...FULL_RED, databaseId: 60, createdAt: "2026-11-09T02:00:00Z" };
    const dispatched = { ...FULL_RED, databaseId: 61, createdAt: "2026-11-09T01:30:00Z" };
    const skipped = [
      { name: "screenshots", conclusion: "failure" },
      { name: "test suite (ubuntu-latest) (dispatch)", conclusion: "skipped" },
    ];
    const onlyShots = fakeGh({
      schedule: [FULL_GREEN],
      dispatch: [shots],
      jobsById: { 51: SUITE_GREEN, 60: skipped },
    });
    const fallback = await latestFullRun(onlyShots);
    expect([fallback?.id, fallback?.red]).toEqual([51, false]);
    const fake = fakeGh({
      schedule: [FULL_GREEN],
      dispatch: [shots, dispatched],
      jobsById: { 51: SUITE_GREEN, 60: skipped, 61: SUITE_FAILED },
    });
    const full = await latestFullRun(fake);
    expect([full?.id, full?.red]).toEqual([61, true]);
  });

  test("a dispatch older than the latest scheduled run is not looked at", async () => {
    const older = { ...FULL_RED, databaseId: 62, createdAt: "2026-11-08T23:00:00Z" };
    const fake = fakeGh({
      schedule: [FULL_GREEN],
      dispatch: [older],
      jobsById: { 62: SUITE_FAILED },
    });
    expect((await latestFullRun(fake))?.id).toBe(51);
    expect(fake.asked.some((a) => a[0] === "run" && a[1] === "view" && a[2] === "62")).toBe(false);
  });

  test("a full run that failed but whose jobs cannot be read is red, never green", async () => {
    const fake = fakeGh({ runs: [GREEN_RUN], schedule: [FULL_RED], jobsFail: [50] });
    const shown = runAt([], fake);
    expect(await shown.code).toBe(1);
    expect(shown.lines[0] ?? "").toStartWith(`main is red: ${FULL_RED.url} (full run, 2h 5m old;`);
  });

  test("the push run is read from push events only, and each run's jobs once per call", async () => {
    const fake = fakeGh({
      runs: [GREEN_RUN],
      schedule: [FULL_RED],
      jobsById: { 50: SUITE_FAILED },
      logById: { 50: FULL_LOG },
    });
    await runAt([], fake).code;
    const pushList = fake.asked.find(
      (a) =>
        a[0] === "run" &&
        a[1] === "list" &&
        !a.includes("schedule") &&
        !a.includes("workflow_dispatch"),
    );
    expect(pushList?.[pushList.indexOf("--event") + 1]).toBe("push");
    const views = fake.asked.filter((a) => a.join(" ") === "run view 50 --json jobs");
    expect(views).toHaveLength(1);
  });

  test("the warning asks for the push run, the full runs and the claims at once, and no jobs of a green full run", async () => {
    const fake = fakeGh({
      runs: [GREEN_RUN],
      schedule: [FULL_GREEN],
      jobsById: { 51: SUITE_GREEN },
    });
    expect(await mainRedLine({ ...fake, now: () => NOW })).toBeNull();
    expect(fake.peak()).toBe(4);
    expect(fake.asked.some((a) => a[0] === "run" && a[1] === "view")).toBe(false);
  });

  test("a full run's red stays until a newer full run is green: a later green push run does not test it", async () => {
    const pushAfter = { ...GREEN_RUN, databaseId: 70, createdAt: "2026-11-09T02:30:00Z" };
    const stillRed = fakeGh({
      runs: [pushAfter],
      schedule: [FULL_RED],
      jobsById: { 50: SUITE_FAILED },
      logById: { 50: FULL_LOG },
    });
    expect(await runAt([], stillRed).code).toBe(1);
    const newerGreen = { ...FULL_GREEN, databaseId: 52, createdAt: "2026-11-09T02:50:00Z" };
    const claimed = { ...issue(30, "fd-qa", ["deps-gate > startCard is the only door"]) };
    const fixed = fakeGh({
      runs: [pushAfter],
      schedule: [newerGreen, FULL_RED],
      jobsById: { 52: SUITE_GREEN },
      claims: [claimed],
    });
    const shown = runAt([], fixed);
    expect(await shown.code).toBe(0);
    expect(shown.lines).toEqual([`main is green: ${pushAfter.url}`, "closed: #30 (fd-qa)"]);
  });

  test("a full run whose suite timed out, was cancelled or did not start is red: only success, skipped and neutral pass", async () => {
    for (const conclusion of ["timed_out", "cancelled", "startup_failure"]) {
      const fake = fakeGh({
        schedule: [FULL_RED],
        jobsById: { 50: [{ name: "test suite (ubuntu-latest)", conclusion }] },
      });
      expect([conclusion, (await latestFullRun(fake))?.red]).toEqual([conclusion, true]);
    }
    const passed = fakeGh({
      schedule: [FULL_RED],
      jobsById: {
        50: [
          { name: "test suite (ubuntu-latest)", conclusion: "success" },
          { name: "screenshots", conclusion: "skipped" },
          { name: "notes", conclusion: "neutral" },
          { name: "test suite (windows-latest)", conclusion: "timed_out" },
        ],
      },
    });
    expect((await latestFullRun(passed))?.red).toBe(false);
  });

  test("a claim made on a red full run closes once a newer full run is green, though the push run is older", async () => {
    const olderPush = { ...GREEN_RUN, databaseId: 71, createdAt: "2026-11-08T20:00:00Z" };
    const newerGreen = { ...FULL_GREEN, databaseId: 52, createdAt: "2026-11-09T02:50:00Z" };
    const fake = fakeGh({
      runs: [olderPush],
      schedule: [newerGreen],
      claims: [issue(30, "fd-qa", ["deps-gate > startCard is the only door"])],
    });
    const shown = runAt([], fake);
    expect(await shown.code).toBe(0);
    expect(shown.lines).toEqual([`main is green: ${olderPush.url}`, "closed: #30 (fd-qa)"]);
  });

  test("full runs gh cannot list leave the claims open: green on the push run, and it says so", async () => {
    const fake = fakeGh({ runs: [GREEN_RUN], fullFail: true, claims: [issue(30, "fd-qa", ["x"])] });
    const shown = runAt([], fake);
    expect(await shown.code).toBe(0);
    expect(shown.lines).toEqual([
      `main is green: ${GREEN_RUN.url} (the full runs could not be read: the claims stay open)`,
    ]);
    expect(fake.asked.some((a) => a[0] === "issue" && a[1] === "close")).toBe(false);
  });

  test("a dispatch whose test suite timed out or was cancelled is a full run, and red", async () => {
    for (const conclusion of ["timed_out", "cancelled"]) {
      const dispatched = { ...FULL_RED, databaseId: 63, createdAt: "2026-11-09T02:00:00Z" };
      const fake = fakeGh({
        schedule: [FULL_GREEN],
        dispatch: [dispatched],
        jobsById: { 63: [{ name: "test suite (ubuntu-latest) (dispatch)", conclusion }] },
      });
      const full = await latestFullRun(fake);
      expect([conclusion, full?.id, full?.red]).toEqual([conclusion, 63, true]);
    }
  });

  test("a newer dispatch whose jobs gh cannot read is taken as the full run, and red", async () => {
    const dispatched = { ...FULL_RED, databaseId: 64, createdAt: "2026-11-09T02:00:00Z" };
    const fake = fakeGh({ schedule: [FULL_GREEN], dispatch: [dispatched], jobsFail: [64] });
    const full = await latestFullRun(fake);
    expect([full?.id, full?.red]).toEqual([64, true]);
  });

  test("a full run GitHub ends as timed_out or startup_failure is red; one a person cancelled is passed over", async () => {
    for (const conclusion of ["timed_out", "startup_failure"]) {
      const ended = { ...FULL_RED, conclusion };
      const fake = fakeGh({ schedule: [ended], jobsById: { 50: [] } });
      const full = await latestFullRun(fake);
      expect([conclusion, full?.id, full?.red]).toEqual([conclusion, 50, true]);
    }
    const cancelled = {
      ...FULL_RED,
      databaseId: 53,
      conclusion: "cancelled",
      createdAt: "2026-11-09T02:00:00Z",
    };
    const fake = fakeGh({ schedule: [cancelled, FULL_GREEN] });
    expect((await latestFullRun(fake))?.id).toBe(51);
  });

  test("at most 5 dispatches have their jobs read", async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      ...FULL_RED,
      databaseId: 80 + i,
      createdAt: `2026-11-09T02:0${i}:00Z`,
    }));
    const fake = fakeGh({ schedule: [FULL_GREEN], dispatch: many });
    await latestFullRun(fake);
    const views = fake.asked.filter((a) => a[0] === "run" && a[1] === "view");
    expect(views).toHaveLength(5);
  });

  test("an age under an hour is told in minutes", async () => {
    const recent = { ...FULL_RED, createdAt: "2026-11-09T02:25:00Z" };
    const fake = fakeGh({ runs: [GREEN_RUN], schedule: [recent], jobsById: { 50: SUITE_FAILED } });
    expect((await mainRedLine({ ...fake, now: () => NOW })) ?? "").toContain("(full run, 40m old;");
  });

  test("a red push run and a green full run: red, and the full run's green verdict is shown", async () => {
    const fake = fakeGh({
      runs: [RED_RUN],
      log: LOG,
      schedule: [FULL_GREEN],
      jobsById: { 51: SUITE_GREEN },
    });
    const shown = runAt([], fake);
    expect(await shown.code).toBe(1);
    expect(shown.lines).toEqual([
      `main is red: ${RED_RUN.url}`,
      "failing: protocolo-compat > host.info traz os recursos",
      "failing: card detail > opens on changes",
      `the full run is green: ${FULL_GREEN.url} (2h 5m old)`,
      'unclaimed: bun run main-red -- claim "<cause>"',
    ]);
  });

  test("the warning and a claim take the full run when only it is red", async () => {
    const opts = {
      runs: [GREEN_RUN],
      schedule: [FULL_RED],
      jobsById: { 50: SUITE_FAILED },
      logById: { 50: FULL_LOG },
    };
    expect(await mainRedLine({ ...fakeGh(opts), now: () => NOW })).toBe(
      `main is red since ${FULL_RED.url} (full run, 2h 5m old; fixed since? ${RERUN}), unclaimed: bun run main-red -- claim "<cause>" before fixing it`,
    );
    const fake = fakeGh(opts);
    expect(await runAt(["claim", "deps-gate after #1348"], fake).code).toBe(0);
    const [create] = created(fake.asked);
    const body = create?.[create.indexOf("--body") + 1] ?? "";
    expect(body.split("\n").filter((l) => /^(Run|Failing|- )/.test(l))).toEqual([
      `Run: ${FULL_RED.url}`,
      `Run at: ${FULL_RED.createdAt}`,
      "Failing:",
      "- deps-gate > startCard is the only door",
    ]);
  });
});
