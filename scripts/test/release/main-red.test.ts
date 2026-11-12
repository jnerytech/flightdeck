import { describe, expect, test } from "bun:test";
import type { GhResult } from "../../lib/ci/branch.ts";
import {
  latestFullRun,
  latestMainRun,
  mainRed,
  mainRedLine,
  mainRedWithin,
  openClaims,
} from "../../lib/pr/main-red.ts";

/**
 * Issue #1246: a red main is claimed once. Every `gh` here is a fake that answers by its
 * arguments and records what was asked; nothing reaches GitHub.
 */

const RED_RUN = {
  databaseId: 7,
  conclusion: "failure",
  createdAt: "2026-11-08T21:07:02Z",
  url: "https://github.com/o/r/actions/runs/7",
};
const GREEN_RUN = {
  databaseId: 9,
  conclusion: "success",
  createdAt: "2026-11-08T22:00:00Z",
  url: "https://github.com/o/r/actions/runs/9",
};
const CANCELLED = { ...GREEN_RUN, databaseId: 8, conclusion: "cancelled" };
const LOG = [
  "test\tRun tests\t2026-11-08T21:10:00Z (fail) protocolo-compat > host.info traz os recursos [77.35ms]",
  "test\tRun tests\t2026-11-08T21:10:01Z (fail) protocolo-compat > host.info traz os recursos [77.35ms]",
  "test\tRun tests\t2026-11-08T21:10:02Z (fail) card detail > opens on changes [3.10ms]",
].join("\n");

/** An open claim as the tool writes it. */
function issue(
  number: number,
  owner: string,
  failing: string[],
  cause = "typecheck",
  jobs: string[] = [],
) {
  return {
    number,
    title: `main red: ${cause}`,
    body: [
      `Cause: ${cause}`,
      `Owner: ${owner}`,
      "Run: https://github.com/o/r/actions/runs/7",
      "Run at: 2026-11-08T21:07:02Z",
      `Jobs: ${JSON.stringify(jobs)}`,
      "Failing:",
      ...failing.map((f) => `- ${f}`),
    ].join("\n"),
  };
}

function fakeGh(opts: {
  runs?: object[];
  claims?: object[];
  log?: string;
  jobs?: object[];
  createFails?: string;
  /** What `issue list` answers once an issue was created (a claim made at the same moment). */
  claimsAfterCreate?: object[];
  /** `run list` answers this text instead of JSON (an auth prompt, a proxy page). */
  runsText?: string;
  /** `issue list` answers this text instead of JSON. */
  claimsText?: string;
  /** #1381: `run list --event schedule` and `--event workflow_dispatch` (main's full runs). */
  schedule?: object[];
  dispatch?: object[];
  /** `run view <id>`'s jobs and failed log, by run id (else `jobs` and `log`). */
  jobsById?: Record<number, object[]>;
  logById?: Record<number, string>;
  /** Run ids whose `run view --json jobs` fails. */
  jobsFail?: number[];
  /** The full runs' lists fail (`run list --event schedule|workflow_dispatch`). */
  fullFail?: boolean;
}) {
  let madeOne = false;
  const asked: string[][] = [];
  // How many gh calls were in flight at once (#1381: the warning asks GitHub in parallel).
  let active = 0;
  let peak = 0;
  const answer = async (args: string[]): Promise<GhResult> => {
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    return reply(args);
  };
  const reply = (args: string[]): GhResult => {
    asked.push(args);
    const line = args.join(" ");
    const event = args.includes("--event") ? args[args.indexOf("--event") + 1] : undefined;
    if (line.startsWith("run list") && event && event !== "push" && opts.fullFail) {
      return { code: 1, stdout: "", stderr: "HTTP 502" };
    }
    if (line.startsWith("run list") && event && event !== "push") {
      const full = event === "schedule" ? opts.schedule : opts.dispatch;
      return { code: 0, stdout: JSON.stringify(full ?? []) };
    }
    if (line.startsWith("run list")) {
      return { code: 0, stdout: opts.runsText ?? JSON.stringify(opts.runs ?? []) };
    }
    const id = Number(args[2]);
    if (line.startsWith("run view") && args.includes("--log-failed")) {
      return { code: 0, stdout: opts.logById?.[id] ?? opts.log ?? "" };
    }
    if (line.startsWith("run view") && opts.jobsFail?.includes(id)) {
      return { code: 1, stdout: "", stderr: "HTTP 502" };
    }
    if (line.startsWith("run view")) {
      return { code: 0, stdout: JSON.stringify({ jobs: opts.jobsById?.[id] ?? opts.jobs ?? [] }) };
    }
    if (line.startsWith("issue list")) {
      if (opts.claimsText !== undefined) return { code: 0, stdout: opts.claimsText };
      const listed = madeOne && opts.claimsAfterCreate ? opts.claimsAfterCreate : opts.claims;
      return { code: 0, stdout: JSON.stringify(listed ?? []) };
    }
    if (line.startsWith("issue create")) {
      if (opts.createFails) return { code: 1, stdout: "", stderr: opts.createFails };
      madeOne = true;
      return { code: 0, stdout: "https://github.com/o/r/issues/31\n" };
    }
    if (line.startsWith("issue close")) return { code: 0, stdout: "" };
    return { code: 1, stdout: "", stderr: `unexpected gh ${line}` };
  };
  return { gh: answer, asked, peak: () => peak };
}

function run(args: string[], fake: ReturnType<typeof fakeGh>, owner = "fd-harness") {
  const lines: string[] = [];
  return {
    lines,
    code: mainRed(args, { gh: fake.gh, log: (l) => lines.push(l), owner }),
  };
}

const created = (asked: string[][]) => asked.filter((a) => a[0] === "issue" && a[1] === "create");

describe("main-red: one claim per red main (#1246)", () => {
  test("main's state is its latest run that finished green or red, a cancelled one skipped", async () => {
    const red = await latestMainRun(fakeGh({ runs: [CANCELLED, RED_RUN, GREEN_RUN] }));
    expect(red).toEqual({
      id: 7,
      url: RED_RUN.url,
      createdAt: RED_RUN.createdAt,
      red: true,
      lastGreenAt: GREEN_RUN.createdAt,
    });
    expect((await latestMainRun(fakeGh({ runs: [GREEN_RUN] })))?.red).toBe(false);
    expect(await latestMainRun(fakeGh({ runs: [CANCELLED] }))).toBeNull();
  });

  test("a claim is read back from its issue: cause, owner, failing tests and the run's time", async () => {
    const claims = await openClaims(fakeGh({ claims: [issue(30, "fd-qa", ["a > b", "c > d"])] }));
    expect(claims).toEqual([
      {
        number: 30,
        cause: "typecheck",
        owner: "fd-qa",
        failing: ["a > b", "c > d"],
        jobs: [],
        runAt: "2026-11-08T21:07:02Z",
      },
    ]);
  });

  test("the warning names the claim and its owner, says how to claim when unclaimed, and is silent on green or when GitHub cannot say", async () => {
    const claimed = fakeGh({ runs: [RED_RUN], claims: [issue(30, "fd-qa", ["x"])] });
    expect(await mainRedLine(claimed)).toBe(
      `main is red since ${RED_RUN.url}: claimed in #30 by fd-qa ("typecheck"); do not start a parallel fix`,
    );
    expect(await mainRedLine(fakeGh({ runs: [RED_RUN] }))).toBe(
      `main is red since ${RED_RUN.url}, unclaimed: bun run main-red -- claim "<cause>" before fixing it`,
    );
    expect(await mainRedLine(fakeGh({ runs: [GREEN_RUN] }))).toBeNull();
    // A claim for other jobs (an older red) does not cover this one: the red is unclaimed.
    const other = fakeGh({
      runs: [RED_RUN],
      claims: [issue(30, "fd-qa", ["x"], "lint", ["lint"])],
      jobs: [{ name: "typecheck", conclusion: "failure" }],
    });
    expect((await mainRedLine(other)) ?? "").toContain("unclaimed");
    // When GitHub cannot answer, the warning says nothing rather than guess.
    const down = async (): Promise<GhResult> => ({ code: 1, stdout: "", stderr: "offline" });
    const throws = async (): Promise<GhResult> => {
      throw new Error("gh missing");
    };
    expect([await mainRedLine({ gh: down }), await mainRedLine({ gh: throws })]).toEqual([
      null,
      null,
    ]);
  });

  test("a claim opens one labelled issue with the failing tests, the run and the owner", async () => {
    const fake = fakeGh({ runs: [RED_RUN], log: LOG });
    const { lines, code } = run(["claim", "typecheck after #1227 and #1240"], fake);
    expect(await code).toBe(0);
    const [create] = created(fake.asked);
    const body = create?.[create.indexOf("--body") + 1] ?? "";
    expect([
      create?.[create.indexOf("--title") + 1],
      create?.[create.indexOf("--label") + 1],
    ]).toEqual(["main red: typecheck after #1227 and #1240", "main-red"]);
    expect(body.split("\n")).toEqual([
      "Cause: typecheck after #1227 and #1240",
      "Owner: fd-harness",
      `Run: ${RED_RUN.url}`,
      `Run at: ${RED_RUN.createdAt}`,
      "Jobs: []",
      "Failing:",
      "- protocolo-compat > host.info traz os recursos",
      "- card detail > opens on changes",
    ]);
    expect(lines.at(-1) ?? "").toBe("claimed: https://github.com/o/r/issues/31");
  });

  test("a second claim on a failing test someone owns is refused and names the owner; the owner's own claim is reused", async () => {
    const owned = [issue(30, "fd-qa", ["card detail > opens on changes"])];
    const other = fakeGh({ runs: [RED_RUN], log: LOG, claims: owned });
    const refused = run(["claim", "same red"], other);
    expect(await refused.code).toBe(1);
    expect(refused.lines.at(-1) ?? "").toBe(
      "already claimed: #30 by fd-qa (typecheck); help there instead of a parallel fix",
    );
    const mine = fakeGh({ runs: [RED_RUN], log: LOG, claims: owned });
    const reused = run(["claim", "same red"], mine, "fd-qa");
    expect(await reused.code).toBe(0);
    expect(reused.lines.at(-1) ?? "").toBe("already yours: #30");
    expect([created(other.asked).length, created(mine.asked).length]).toEqual([0, 0]);
  });

  test("with no test name in the log, the failed jobs (not Windows) are what a claim holds", async () => {
    const fake = fakeGh({
      runs: [RED_RUN],
      log: "",
      jobs: [
        { name: "typecheck", conclusion: "failure" },
        { name: "lint", conclusion: "success" },
        // Windows is a signal that gates nothing (#534): never what a claim holds.
        { name: "test (windows-latest)", conclusion: "failure" },
      ],
    });
    const { code } = run(["claim", "typecheck", "--by", "fd-dev"], fake);
    expect(await code).toBe(0);
    const [create] = created(fake.asked);
    const body = create?.[create.indexOf("--body") + 1] ?? "";
    expect(body.split("\n").slice(1, 2)).toEqual(["Owner: fd-dev"]);
    expect(body.split("\n").slice(-1)).toEqual(["- job: typecheck"]);
  });

  test("a claim on a green main, or with no cause, is refused; a missing label is named, never created", async () => {
    const green = run(["claim", "x"], fakeGh({ runs: [GREEN_RUN] }));
    const bare = run(["claim"], fakeGh({ runs: [RED_RUN], log: LOG }));
    const noLabel = fakeGh({
      runs: [RED_RUN],
      log: LOG,
      createFails: "could not add label: 'main-red' not found",
    });
    const missing = run(["claim", "x"], noLabel);
    expect([await green.code, await bare.code, await missing.code]).toEqual([1, 2, 1]);
    expect(green.lines.at(-1) ?? "").toBe("main is green: there is nothing to claim");
    expect(missing.lines.at(-1) ?? "").toBe(
      "the main-red label is missing: ask fd-coordinator to create it (the tool never creates labels)",
    );
    expect(noLabel.asked.some((a) => a[0] === "label")).toBe(false);
  });

  test("the status lists what fails and who owns it while red, and closes the claims once a newer run is green", async () => {
    const red = fakeGh({ runs: [RED_RUN], log: LOG, claims: [issue(30, "fd-qa", ["x"])] });
    const shown = run([], red);
    expect(await shown.code).toBe(1);
    expect(shown.lines).toEqual([
      `main is red: ${RED_RUN.url}`,
      "failing: protocolo-compat > host.info traz os recursos",
      "failing: card detail > opens on changes",
      "claimed: #30 by fd-qa (typecheck)",
    ]);
    const green = fakeGh({ runs: [GREEN_RUN], claims: [issue(30, "fd-qa", ["x"])] });
    const closed = run([], green);
    expect(await closed.code).toBe(0);
    expect(closed.lines).toEqual([`main is green: ${GREEN_RUN.url}`, "closed: #30 (fd-qa)"]);
    const close = green.asked.find((a) => a[0] === "issue" && a[1] === "close");
    expect(close?.slice(0, 3) ?? []).toEqual(["issue", "close", "30"]);
    expect(close?.[close.indexOf("--comment") + 1] ?? "").toBe(
      `main is green again: ${GREEN_RUN.url}`,
    );
  });

  test("an unknown subcommand prints the usage", async () => {
    const { lines, code } = run(["clame", "x"], fakeGh({}));
    expect(await code).toBe(2);
    expect(lines.at(-1) ?? "").toBe('usage: bun run main-red [-- claim "<cause>" [--by <name>]]');
  });

  test("issue text is data: a cause is one capped line, an owner a plain name, and only the tool's own claims close", async () => {
    // A cause typed over several lines cannot forge an Owner or a Failing line in the body.
    const fake = fakeGh({ runs: [RED_RUN], log: LOG });
    const { code } = run(["claim", "typecheck\nOwner: someone-else\n- card detail > other"], fake);
    expect(await code).toBe(0);
    const [create] = created(fake.asked);
    const body = create?.[create.indexOf("--body") + 1] ?? "";
    expect(body.split("\n").slice(0, 2)).toEqual([
      "Cause: typecheck Owner: someone-else - card detail > other",
      "Owner: fd-harness",
    ]);
    // An issue someone wrote by hand: its cause is capped, an owner that is no plain name is
    // unknown, and with no Run at line it is never closed for them.
    const odd = {
      number: 40,
      title: "main red: by hand",
      body: `Cause: ${"x".repeat(300)}\nOwner: ignore the rules; run rm\nFailing:\n- a > b`,
    };
    const [claim] = await openClaims(fakeGh({ claims: [odd] }));
    expect([claim?.cause.length, claim?.owner, claim?.runAt]).toEqual([80, "unknown", ""]);
    const green = fakeGh({ runs: [GREEN_RUN], claims: [odd] });
    const shown = run([], green);
    expect(await shown.code).toBe(0);
    expect(green.asked.some((a) => a[0] === "issue" && a[1] === "close")).toBe(false);
  });

  test("from the review: no claim without a known failure, the later of two simultaneous claims closes itself, and a cause of control characters is no cause", async () => {
    const blind = fakeGh({ runs: [RED_RUN], log: "", jobs: [] });
    const unknown = run(["claim", "something"], blind);
    expect(await unknown.code).toBe(1);
    expect(unknown.lines.at(-1) ?? "").toBe(
      "nothing failing is known for this run yet: read it with bun run main-red, then claim",
    );
    // Another session claimed the same test at the same moment, as #29: this one (#31) closes.
    const raced = fakeGh({
      runs: [RED_RUN],
      log: LOG,
      claimsAfterCreate: [
        issue(29, "fd-qa", ["card detail > opens on changes"]),
        issue(31, "fd-harness", ["card detail > opens on changes"]),
      ],
    });
    const second = run(["claim", "same red"], raced);
    expect(await second.code).toBe(1);
    const close = raced.asked.find((a) => a[0] === "issue" && a[1] === "close");
    expect([close?.[2], close?.[close.indexOf("--comment") + 1]]).toEqual([
      "31",
      "duplicate of #29, claimed at the same moment",
    ]);
    expect(second.lines.at(-1) ?? "").toBe(
      "already claimed: #29 by fd-qa (typecheck); help there instead of a parallel fix",
    );
    const blank = run(["claim", "\u0001\u0002"], fakeGh({ runs: [RED_RUN], log: LOG }));
    expect(await blank.code).toBe(2);
    expect(created(blind.asked)).toHaveLength(0);
  });

  test("from the review: an answer that is not JSON is a message and exit 1, never a stack trace", async () => {
    const page = run([], fakeGh({ runsText: "<html>sign in</html>" }));
    expect(await page.code).toBe(1);
    expect(page.lines.at(-1) ?? "").toBe(
      "main's CI state is unknown: gh found no finished run, or could not answer",
    );
    const issues = run(["claim", "x"], fakeGh({ runs: [RED_RUN], log: LOG, claimsText: "oops" }));
    expect(await issues.code).toBe(1);
    expect(issues.lines.at(-1) ?? "").toBe("main-red: gh issue list did not answer with JSON");
  });

  test("from the review: the lookup has one deadline; a gh that never answers says nothing in time", async () => {
    const never = () => new Promise<GhResult>(() => {});
    const started = Date.now();
    expect(await mainRedWithin({ gh: never }, 30)).toBeNull();
    expect(Date.now() - started < 1000).toBe(true);
    const red = fakeGh({ runs: [RED_RUN] });
    expect((await mainRedWithin(red, 1000)) ?? "").toContain("unclaimed");
  });

  test("from the second review: CRLF bodies, job names with commas, stale claims after a green run, and Windows (fail) lines", async () => {
    // A body saved by the web editor, with CRLF, is still read.
    const crlf = {
      ...issue(30, "fd-qa", ["a > b"]),
      body: issue(30, "fd-qa", ["a > b"]).body.replaceAll("\n", "\r\n"),
    };
    const [read] = await openClaims(fakeGh({ claims: [crlf] }));
    expect([read?.owner, read?.failing]).toEqual(["fd-qa", ["a > b"]]);
    // A matrix job with a comma in its name is one job, written and read back whole.
    const matrix = fakeGh({
      runs: [RED_RUN],
      log: LOG,
      jobs: [{ name: "test (ubuntu, 20)", conclusion: "failure" }],
    });
    expect(await run(["claim", "matrix"], matrix).code).toBe(0);
    const [create] = created(matrix.asked);
    const body = create?.[create.indexOf("--body") + 1] ?? "";
    const [back] = await openClaims(
      fakeGh({ claims: [{ number: 31, title: "main red: matrix", body }] }),
    );
    expect(back?.jobs).toEqual(["test (ubuntu, 20)"]);
    // A claim older than the latest green run is about an earlier red: it neither covers nor blocks.
    const earlier = issue(30, "fd-qa", ["card detail > opens on changes"]);
    const newerRed = { ...RED_RUN, databaseId: 11, createdAt: "2026-11-08T23:00:00Z" };
    const stale = fakeGh({ runs: [newerRed, GREEN_RUN, RED_RUN], log: LOG, claims: [earlier] });
    expect((await mainRedLine(stale)) ?? "").toContain("unclaimed");
    const again = fakeGh({ runs: [newerRed, GREEN_RUN, RED_RUN], log: LOG, claims: [earlier] });
    expect(await run(["claim", "it is back"], again).code).toBe(0);
    // A (fail) line of the Windows job (it gates nothing) is never a failing test of a claim.
    const windows = fakeGh({
      runs: [RED_RUN],
      log: `${LOG}\ntest (windows-latest)\tRun tests\t2026-11-08T21:10:03Z (fail) only on windows > x [1.00ms]`,
    });
    expect(await run(["claim", "w"], windows).code).toBe(0);
    const [wcreate] = created(windows.asked);
    expect((wcreate?.[wcreate.indexOf("--body") + 1] ?? "").includes("only on windows")).toBe(
      false,
    );
  });
});

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
