import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, project, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const round = (n: number, status: string, over: Record<string, unknown> = {}) => ({
  id: `r${n}`,
  cardId: "c1",
  n,
  status,
  trigger: { failed: ["lint"], conflicts: false, comments: [] },
  summary: n === 1 ? "fixed the lint" : null,
  sessionId: null,
  costUsd: 0.4,
  turns: 4,
  startedAt: "2026-11-20T09:00:00Z",
  endedAt: null,
  ...over,
});

const WATCHING = {
  cardId: "c1",
  enabled: true,
  status: "watching",
  reason: null,
  rounds: [round(1, "pushed")],
  roundsUsed: 1,
  maxRounds: 3,
};

const TRACE = {
  cardId: "c1",
  title: "Fix the login",
  prUrl: "https://github.com/o/r/pull/9",
  workItem: "AB#12",
  sessions: [
    {
      sessionId: "s1",
      claudeSessionId: "cs1",
      name: "author",
      kind: "run",
      startedAt: "2026-11-20T08:00:00Z",
      costUsd: 0.8,
      checkpoints: 2,
    },
  ],
  rounds: [round(1, "pushed")],
  costUsd: 1.2,
};

const SETTINGS = {
  enabled: true,
  maxRounds: 3,
  checks: ["bun test", "bun run lint"],
  checkTimeoutMin: 10,
  budgetUsd: 5,
  maxTurns: null,
  persona: "developer",
  maxFailures: 2,
  dailyUsd: null,
};

const OPEN: Handlers = {
  "project.list": () => ({
    projects: [project("p1", "api"), project("p2", "web"), project("p3", "web")],
    maxParallelRuns: 2,
  }),
  "watch.get": () => WATCHING,
  "watch.trace": () => TRACE,
  "watch.describe": () => ({ text: "Fixes the login.\n\nTested by hand.", redacted: 0 }),
  "watch.byUrl": () => ({ via: "card", trace: TRACE, sessions: [] }),
  "watch.settings": () => SETTINGS,
};

/** The one JSON value a `--json` run printed, or null when it printed none. */
const printed = (out: string[]) => {
  try {
    return JSON.parse(out.join("\n")) as unknown;
  } catch {
    return null;
  }
};

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

describe("flightdeckd watch get (issue #3539)", () => {
  test("a watched card is its state, the rounds used and one line a round with the id a later verb takes", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["watch", "get", "c1"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "c1: watching, 1 of 3 rounds used",
        "  round 1 (r1): pushed, $0.40, 4 turns: fixed the lint",
      ],
      err: [],
    });
    expect(callsOf(daemon, "watch.get")).toEqual([{ cardId: "c1" }]);
  });

  test("a card that needs the person says why; a card with no watch says so", async () => {
    const stopped = fakeDaemon({
      ...OPEN,
      "watch.get": () => ({
        ...WATCHING,
        status: "needs_you",
        reason: "the round limit was reached",
        roundsUsed: 3,
        rounds: [],
      }),
    });
    const off = fakeDaemon({
      ...OPEN,
      "watch.get": () => ({ ...WATCHING, enabled: false, rounds: [] }),
    });
    expect((await flightdeckd(["watch", "get", "c1"], stopped.port)).out).toEqual([
      "c1: needs you: the round limit was reached, 3 of 3 rounds used",
    ]);
    expect((await flightdeckd(["watch", "get", "c1"], off.port)).out).toEqual([
      "c1: watch off, 1 of 3 rounds used",
    ]);
  });

  test("--json prints every key, null where an older daemon sends none", async () => {
    const older = {
      cardId: "c1",
      enabled: true,
      status: "watching",
      reason: null,
      rounds: [round(2, "held", { drift: undefined })],
    };
    const daemon = fakeDaemon({ ...OPEN, "watch.get": () => older });
    const run = await flightdeckd(["watch", "get", "c1", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toMatchObject({
      cardId: "c1",
      reason: null,
      roundsUsed: null,
      maxRounds: null,
      rounds: [{ id: "r2", status: "held", drift: null }],
    });
  });

  test("a held round shows the files outside its PR", async () => {
    const held = round(2, "held", {
      drift: { outside: ["bun.lock", "a.ts"], churn: 40, limit: 30 },
    });
    const daemon = fakeDaemon({
      ...OPEN,
      "watch.get": () => ({ ...WATCHING, rounds: [held], roundsUsed: 2 }),
    });
    const run = await flightdeckd(["watch", "get", "c1"], daemon.port);
    expect(run.out[1]).toBe("  round 2 (r2): held, $0.40, 4 turns, 2 files outside the PR");
  });

  test("a card the daemon does not know is one line on stderr and exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "watch.get": () => ({ error: { code: "not_found", message: "card not found" } }),
    });
    const run = await flightdeckd(["watch", "get", "nope"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("card not found");
  });

  test("a daemon that closes the connection is exit 2", async () => {
    const daemon = fakeDaemon({ ...OPEN, "watch.get": () => CLOSE });
    const run = await flightdeckd(["watch", "get", "c1"], daemon.port);
    expect(run.code).toBe(2);
  });

  test("text from the daemon cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "watch.get": () => ({
        ...WATCHING,
        rounds: [round(1, "pushed", { summary: "\u001b[2Jwiped" })],
      }),
    });
    const run = await flightdeckd(["watch", "get", "c1"], daemon.port);
    expect(run.out.join("\n")).toContain("wiped");
    expect(run.out.join("\n").includes("\u001b")).toBe(false);
  });
});

describe("flightdeckd watch trace (issue #3539)", () => {
  test("the card, its PR, its work item, its cost, its sessions and its rounds", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["watch", "trace", "c1"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "Fix the login (c1)",
        "PR: https://github.com/o/r/pull/9",
        "work item: AB#12",
        "cost: $1.20",
        "sessions:",
        "  s1  run  2026-11-20T08:00:00Z  $0.80  2 checkpoints  author",
        "rounds:",
        "  round 1 (r1): pushed, $0.40, 4 turns: fixed the lint",
      ],
      err: [],
    });
    expect(callsOf(daemon, "watch.trace")).toEqual([{ cardId: "c1" }]);
  });

  test("a card with no PR, no work item and no cost says none and unknown, and lists nothing else", async () => {
    const bare = { ...TRACE, prUrl: null, workItem: null, costUsd: null, sessions: [], rounds: [] };
    const daemon = fakeDaemon({ ...OPEN, "watch.trace": () => bare });
    const run = await flightdeckd(["watch", "trace", "c1"], daemon.port);
    expect(run.out).toEqual(["Fix the login (c1)", "PR: none", "work item: none", "cost: unknown"]);
  });

  test("--json prints the trace as the protocol returns it", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["watch", "trace", "c1", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toMatchObject({ cardId: "c1", prUrl: TRACE.prUrl, costUsd: 1.2 });
  });
});

describe("flightdeckd watch describe (issue #3539)", () => {
  test("the description is printed as lines, so it can go to a file or a PR", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["watch", "describe", "c1"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["Fixes the login.", "", "Tested by hand."],
      err: [],
    });
    expect(callsOf(daemon, "watch.describe")).toEqual([{ cardId: "c1" }]);
  });

  test("the lines the daemon left out for looking like a secret are counted on stderr, not in the text", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "watch.describe": () => ({ text: "Fixes the login.", redacted: 2 }),
    });
    const run = await flightdeckd(["watch", "describe", "c1"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 0, out: ["Fixes the login."] });
    expect(run.err).toEqual(["flightdeckd: 2 lines looked like a secret and were left out"]);
  });

  test("--json prints the text and the count", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "watch.describe": () => ({ text: "Fixes the login.", redacted: 1 }),
    });
    const run = await flightdeckd(["watch", "describe", "c1", "--json"], daemon.port);
    expect(printed(run.out)).toEqual({ text: "Fixes the login.", redacted: 1 });
  });
});

describe("flightdeckd watch by-url (issue #3539)", () => {
  const URL = "https://github.com/o/r/pull/9";

  test("a PR of a card is the card's trace, found by the link", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["watch", "by-url", URL], daemon.port);
    expect(run.code).toBe(0);
    expect(run.out.slice(0, 2)).toEqual(["via: card", "Fix the login (c1)"]);
    expect(callsOf(daemon, "watch.byUrl")).toEqual([{ url: URL }]);
  });

  test("a PR only the history mentions lists those sessions", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "watch.byUrl": () => ({
        via: "history",
        trace: null,
        sessions: [{ claudeSessionId: "cs9", title: "old fix", cwd: "/w/api" }],
      }),
    });
    const run = await flightdeckd(["watch", "by-url", URL], daemon.port);
    expect(run.out).toEqual(["via: history", "  cs9  old fix  /w/api"]);
  });

  test("a PR nothing knows is via none, exit 0, and --json says the same", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "watch.byUrl": () => ({ via: "none", trace: null, sessions: [] }),
    });
    const text = await flightdeckd(["watch", "by-url", URL], daemon.port);
    expect({ code: text.code, out: text.out }).toEqual({
      code: 0,
      out: ["via: none: no card and no session in the history mentions it"],
    });
    const asJson = await flightdeckd(["watch", "by-url", URL, "--json"], daemon.port);
    expect(printed(asJson.out)).toEqual({ via: "none", trace: null, sessions: [] });
  });
});

describe("flightdeckd watch settings (issue #3539)", () => {
  test("a project by name is its settings, one line each, and the request carries the id and no patch", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["watch", "settings", "api"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "api: PR watch settings",
        "enabled: true",
        "max-rounds: 3",
        "checks: bun test, bun run lint",
        "check-timeout-min: 10",
        "budget-usd: 5",
        "max-turns: none",
        "persona: developer",
        "max-failures: 2",
        "daily-usd: none",
        "check-rounds: unknown",
        "check-env: unknown",
        "check-loop-default: unknown",
        "drift-allow: unknown",
      ],
      err: [],
    });
    expect(callsOf(daemon, "watch.settings")).toEqual([{ projectId: "p1" }]);
  });

  test("--json prints every key, null for what an older daemon leaves out", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["watch", "settings", "p1", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual({
      ...SETTINGS,
      checkRounds: null,
      checkEnv: null,
      checkLoopDefault: null,
      driftAllow: null,
    });
  });

  test("a name two projects share, or none has, asks the daemon for nothing", async () => {
    const daemon = fakeDaemon(OPEN);
    const two = await flightdeckd(["watch", "settings", "web"], daemon.port);
    const none = await flightdeckd(["watch", "settings", "nope"], daemon.port);
    expect([two.code, none.code]).toEqual([1, 1]);
    expect(two.err.join("")).toContain("is the name of several projects");
    expect(none.err.join("")).toContain('no project named "nope"');
    expect(callsOf(daemon, "watch.settings")).toEqual([]);
  });
});

describe("the arguments of the watch read verbs (issue #3539)", () => {
  const parsed = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };

  test("each verb reads its operand, --json and --host", () => {
    expect(parsed(["watch", "get", "c1", "--json"])).toMatchObject({
      command: "watch",
      action: "get",
      watchTarget: "c1",
      json: true,
    });
    expect(parsed(["watch", "trace", "c1", "--host", "pi"])).toMatchObject({
      command: "watch",
      action: "trace",
      watchTarget: "c1",
      host: "pi",
    });
    expect(parsed(["watch", "describe", "c1"])).toMatchObject({ action: "describe" });
    expect(parsed(["watch", "by-url", "https://x/pull/1"])).toMatchObject({
      action: "by-url",
      watchTarget: "https://x/pull/1",
    });
    expect(parsed(["watch", "settings", "api"])).toMatchObject({
      action: "settings",
      watchTarget: "api",
    });
  });

  test("a missing operand, an unknown verb or a second operand is refused before anything is sent", () => {
    expect(JSON.stringify(parsed(["watch", "get"]))).toContain("missing the card");
    expect(JSON.stringify(parsed(["watch", "by-url"]))).toContain("missing the PR link");
    expect(JSON.stringify(parsed(["watch", "settings"]))).toContain("missing the project");
    expect(JSON.stringify(parsed(["watch"]))).toContain("invalid watch action");
    expect(JSON.stringify(parsed(["watch", "set", "c1"]))).toContain("invalid watch action");
    expect(JSON.stringify(parsed(["watch", "get", "c1", "c2"]))).toContain("unknown argument: c2");
  });
});

describe("the watch read verbs, after the review (issue #3539)", () => {
  test("trace --json and by-url --json give a round's drift as null when an older daemon sends none, as get does", async () => {
    const daemon = fakeDaemon(OPEN);
    const trace = await flightdeckd(["watch", "trace", "c1", "--json"], daemon.port);
    const byUrl = await flightdeckd(
      ["watch", "by-url", "https://github.com/o/r/pull/9", "--json"],
      daemon.port,
    );
    const traced = printed(trace.out) as { rounds: Record<string, unknown>[] };
    const found = printed(byUrl.out) as { trace: { rounds: Record<string, unknown>[] } };
    expect(traced.rounds[0]?.drift).toBeNull();
    expect(found.trace.rounds[0]?.drift).toBeNull();
  });

  test("a link the daemon matched to a card with no trace to show is still via: card", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "watch.byUrl": () => ({ via: "card", trace: null, sessions: [] }),
    });
    const run = await flightdeckd(
      ["watch", "by-url", "https://github.com/o/r/pull/9"],
      daemon.port,
    );
    expect({ code: run.code, out: run.out }).toEqual({ code: 0, out: ["via: card"] });
  });

  test("a description that ends in a line break does not print an extra blank line", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "watch.describe": () => ({ text: "Fixes the login.\n", redacted: 0 }),
    });
    const run = await flightdeckd(["watch", "describe", "c1"], daemon.port);
    expect(run.out).toEqual(["Fixes the login."]);
  });
});
