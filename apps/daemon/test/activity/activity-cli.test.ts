import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const SINCE = "2026-11-20T00:00:00.000Z";

const RESULT = {
  since: SINCE,
  sessions: {
    items: [{ id: "s1", name: "api work", cwd: "/work/api", at: "2026-11-20T10:00:00Z" }],
    total: 1,
  },
  reviewCards: {
    items: [{ cardId: "c1", projectId: "p1", title: "Fix boot", at: "2026-11-20T11:00:00Z" }],
    total: 3,
  },
  prs: {
    items: [
      {
        cardId: "c2",
        projectId: "p1",
        title: "Add vault",
        at: "2026-11-20T12:00:00Z",
        prUrl: "https://github.com/o/r/pull/9",
        outcome: "merged",
      },
    ],
    total: 1,
  },
  failedRuns: {
    items: [
      {
        runId: "r1",
        cardId: "c3",
        workflowName: "feature",
        reasonKey: "run.failed",
        reasonParams: null,
        at: "2026-11-20T13:00:00Z",
      },
    ],
    total: 1,
  },
  quota: [
    { window: "five_hour", utilization: 0.42 },
    { window: "seven_day", utilization: null },
  ],
};

const EMPTY = {
  since: SINCE,
  sessions: { items: [], total: 0 },
  reviewCards: { items: [], total: 0 },
  prs: { items: [], total: 0 },
  failedRuns: { items: [], total: 0 },
  quota: [],
};

const printed = (out: string[]) => {
  try {
    return JSON.parse(out.join("\n")) as unknown;
  } catch {
    return null;
  }
};

const callsOf = (daemon: ReturnType<typeof fakeDaemon>) =>
  daemon.calls.filter((c) => c.type === "activity.since").map((c) => c.payload);

describe("flightdeckd activity since (issue #3736)", () => {
  test("a section each with its items, 'n of m' when the daemon cut the list, and the quota last", async () => {
    const daemon = fakeDaemon({ "activity.since": () => RESULT });
    const run = await flightdeckd(["activity", "since", SINCE], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        `since ${SINCE}`,
        "sessions ended: 1",
        "  s1 api work, /work/api, 2026-11-20T10:00:00Z",
        "cards in review: 1 of 3",
        "  c1 Fix boot, 2026-11-20T11:00:00Z",
        "pull requests: 1",
        "  c2 Add vault, merged, https://github.com/o/r/pull/9, 2026-11-20T12:00:00Z",
        "failed runs: 1",
        "  r1 feature on card c3, run.failed, 2026-11-20T13:00:00Z",
        "quota: five_hour 42%, seven_day unknown",
      ],
      err: [],
    });
    expect(callsOf(daemon)).toEqual([{ since: SINCE }]);
  });

  test("a time with an offset is sent as the same instant in UTC, and --limit goes along", async () => {
    const daemon = fakeDaemon({ "activity.since": () => EMPTY });
    await flightdeckd(
      ["activity", "since", "2026-11-20T02:00:00+02:00", "--limit", "50"],
      daemon.port,
    );
    await flightdeckd(["activity", "since", "2026-11-20T00:00Z", "--limit", "1"], daemon.port);
    expect(callsOf(daemon)).toEqual([
      { since: SINCE, limit: 50 },
      { since: SINCE, limit: 1 },
    ]);
  });

  test("nothing since says so, and --json has every key with null for what is missing", async () => {
    const daemon = fakeDaemon({ "activity.since": () => EMPTY });
    const text = await flightdeckd(["activity", "since", SINCE], daemon.port);
    expect(text.out).toEqual([`since ${SINCE}`, "nothing happened since then"]);
    const rich = fakeDaemon({ "activity.since": () => RESULT });
    const json = await flightdeckd(["activity", "since", SINCE, "--json"], rich.port);
    expect(printed(json.out)).toEqual({
      since: SINCE,
      sessions: RESULT.sessions,
      reviewCards: RESULT.reviewCards,
      prs: RESULT.prs,
      failedRuns: {
        total: 1,
        items: [{ ...RESULT.failedRuns.items[0], projectId: null }],
      },
      quota: RESULT.quota,
    });
  });

  test("a session without a name is (unnamed), and null in --json", async () => {
    const daemon = fakeDaemon({
      "activity.since": () => ({
        ...EMPTY,
        sessions: {
          items: [{ id: "s2", name: null, cwd: "/w", at: "2026-11-20T09:00:00Z" }],
          total: 1,
        },
      }),
    });
    const text = await flightdeckd(["activity", "since", SINCE], daemon.port);
    expect(text.out).toContain("  s2 (unnamed), /w, 2026-11-20T09:00:00Z");
  });

  test("a card title cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      "activity.since": () => ({
        ...EMPTY,
        reviewCards: {
          items: [
            { cardId: "c1", projectId: "p1", title: "\u001b[2Jwiped", at: "2026-11-20T11:00:00Z" },
          ],
          total: 1,
        },
      }),
    });
    const run = await flightdeckd(["activity", "since", SINCE], daemon.port);
    expect(run.out.join("\n")).toContain("wiped");
    expect(run.out.join("\n").includes("\u001b")).toBe(false);
  });

  test("a time that is not an ISO date and time is exit 1 and connects to nothing", async () => {
    const daemon = fakeDaemon({ "activity.since": () => EMPTY });
    for (const bad of ["yesterday", "2026-11-20", "2026-13-40T00:00:00Z", "1700000000", ""]) {
      const run = await flightdeckd(["activity", "since", bad], daemon.port);
      expect({ bad, code: run.code }).toEqual({ bad, code: 1 });
      expect(run.err.join("\n")).toContain("an ISO date and time");
    }
    expect(daemon.calls).toEqual([]);
  });

  test("a --limit outside 1 to 50 is exit 1 and connects to nothing", async () => {
    const daemon = fakeDaemon({ "activity.since": () => EMPTY });
    for (const bad of ["0", "51", "abc"]) {
      const run = await flightdeckd(["activity", "since", SINCE, "--limit", bad], daemon.port);
      expect({ bad, code: run.code }).toEqual({ bad, code: 1 });
      expect(run.err.join("\n")).toContain("--limit needs a whole number from 1 to 50");
    }
    expect(daemon.calls).toEqual([]);
  });

  test("a closed connection is exit 2", async () => {
    const daemon = fakeDaemon({ "activity.since": () => CLOSE });
    expect((await flightdeckd(["activity", "since", SINCE], daemon.port)).code).toBe(2);
  });
});

describe("flightdeckd activity words (issue #3736)", () => {
  const argsOf = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };
  const refused = (argv: string[]) => (argsOf(argv) as { refusedWith?: string }).refusedWith;

  test("`activity since <time> [--limit n]` takes --host and --json", () => {
    expect(
      argsOf(["activity", "since", SINCE, "--limit", "5", "--host", "pi", "--json"]),
    ).toMatchObject({
      command: "activity",
      action: "since",
      activitySince: SINCE,
      limit: 5,
      host: "pi",
      json: true,
    });
  });

  test("a missing verb or time, and a flag that is not its own, are refused", () => {
    expect(refused(["activity"])).toContain("invalid activity action");
    expect(refused(["activity", "feed"])).toContain("invalid activity action");
    expect(refused(["activity", "since"])).toContain("the time");
    expect(refused(["activity", "since", SINCE, "--lines", "5"])).toContain("--lines");
  });
});
