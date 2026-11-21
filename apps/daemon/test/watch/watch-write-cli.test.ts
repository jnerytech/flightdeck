import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { runWatchCli } from "../../src/watch/index.ts";
import {
  CLOSE,
  config,
  fakeDaemon,
  type Handlers,
  project,
  stopAll,
} from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const round = (n: number, status: string) => ({
  id: `r${n}`,
  cardId: "c1",
  n,
  status,
  trigger: { failed: ["lint"], conflicts: false, comments: [] },
  summary: null,
  sessionId: null,
  costUsd: 0.4,
  turns: 4,
  startedAt: "2026-11-20T09:00:00Z",
  endedAt: null,
});

const watching = (enabled: boolean, rounds = [round(1, "pushed")]) => ({
  cardId: "c1",
  enabled,
  status: "watching",
  reason: null,
  rounds,
  roundsUsed: rounds.length,
  maxRounds: 3,
});

const SETTINGS = {
  enabled: true,
  maxRounds: 4,
  checks: ["bun test"],
  checkTimeoutMin: 10,
  budgetUsd: 5,
  maxTurns: null,
  persona: "developer",
  maxFailures: 2,
  dailyUsd: null,
};

const OPEN: Handlers = {
  "project.list": () => ({ projects: [project("p1", "api")], maxParallelRuns: 2 }),
  "watch.set": (payload) => watching(payload.enabled !== false),
  "watch.extend": () => watching(true),
  "watch.resolveHeld": () => watching(true, [round(1, "pushed")]),
  "watch.settings": () => SETTINGS,
};

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

const printed = (out: string[]) => {
  try {
    return JSON.parse(out.join("\n")) as unknown;
  } catch {
    return null;
  }
};

const refused = (argv: string[]): string => {
  try {
    parseArgs(argv);
    return "";
  } catch (error) {
    return (error as Error).message;
  }
};

describe("flightdeckd watch set (issue #3539)", () => {
  test("--enable, --disable and --default send true, false and null for the card", async () => {
    const daemon = fakeDaemon(OPEN);
    const on = await flightdeckd(["watch", "set", "c1", "--enable"], daemon.port);
    await flightdeckd(["watch", "set", "c1", "--disable"], daemon.port);
    await flightdeckd(["watch", "set", "c1", "--default"], daemon.port);
    expect({ code: on.code, out: on.out, err: on.err }).toEqual({
      code: 0,
      out: ["c1: watching, 1 of 3 rounds used", "  round 1 (r1): pushed, $0.40, 4 turns"],
      err: [],
    });
    expect(callsOf(daemon, "watch.set")).toEqual([
      { cardId: "c1", enabled: true },
      { cardId: "c1", enabled: false },
      { cardId: "c1", enabled: null },
    ]);
  });

  test("--json prints the watch with its stable keys", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["watch", "set", "c1", "--disable", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toMatchObject({ cardId: "c1", enabled: false, reason: null });
  });

  test("no switch, or two, is refused before anything is sent", async () => {
    expect(refused(["watch", "set", "c1"])).toContain("--enable, --disable or --default");
    expect(refused(["watch", "set", "c1", "--enable", "--disable"])).toContain("not more than one");
    expect(refused(["watch", "set", "c1", "--enable", "--default"])).toContain("not more than one");
  });

  test("a card the daemon refuses is exit 1 with its line, and a silent daemon leaves a write unknown", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "watch.set": () => ({ error: { code: "not_found", message: "card not found" } }),
    });
    const run = await flightdeckd(["watch", "set", "nope", "--enable"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("card not found");

    const silent = fakeDaemon({});
    const result = await runWatchCli(
      { action: "set", target: "c1", enabled: true },
      config(silent.port),
      { timeoutMs: 200 },
    );
    expect(result.code).toBe(2);
    expect(result.err.join("\n")).toContain("may or may not have been");
  });
});

describe("flightdeckd watch extend (issue #3539)", () => {
  test("--rounds N allows N more rounds and prints the card's watch", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["watch", "extend", "c1", "--rounds", "3"], daemon.port);
    expect(run.code).toBe(0);
    expect(run.out[0]).toBe("c1: watching, 1 of 3 rounds used");
    expect(callsOf(daemon, "watch.extend")).toEqual([{ cardId: "c1", rounds: 3 }]);
  });

  test("a card that is not watched is exit 1 with watch_off", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "watch.extend": () => ({ error: { code: "watch_off", message: "the card is not watched" } }),
    });
    const run = await flightdeckd(["watch", "extend", "c1", "--rounds", "3"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("the card is not watched");
  });

  test("--rounds is required and runs from 1 to 10", () => {
    expect(refused(["watch", "extend", "c1"])).toContain("missing --rounds");
    expect(refused(["watch", "extend", "c1", "--rounds", "0"])).toContain("from 1 to 10");
    expect(refused(["watch", "extend", "c1", "--rounds", "11"])).toContain("from 1 to 10");
  });
});

describe("flightdeckd watch resolve-held (issue #3539)", () => {
  test("--push and --drop send the card, the round and the action, and say which round", async () => {
    const daemon = fakeDaemon(OPEN);
    const pushed = await flightdeckd(["watch", "resolve-held", "c1", "r1", "--push"], daemon.port);
    const dropped = await flightdeckd(["watch", "resolve-held", "c1", "r1", "--drop"], daemon.port);
    expect(pushed.out[0]).toBe("pushed round r1");
    expect(dropped.out[0]).toBe("dropped round r1");
    expect(callsOf(daemon, "watch.resolveHeld")).toEqual([
      { cardId: "c1", roundId: "r1", action: "push" },
      { cardId: "c1", roundId: "r1", action: "drop" },
    ]);
  });

  test("a closed PR and a round that is not held are exit 1 with the daemon's line", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "watch.resolveHeld": () => ({
        error: { code: "watch_pr_not_open", message: "the pull request is not open" },
      }),
    });
    const run = await flightdeckd(["watch", "resolve-held", "c1", "r1", "--push"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("the pull request is not open");
  });

  test("it needs the round and one of --push or --drop", () => {
    expect(refused(["watch", "resolve-held", "c1"])).toContain("missing the round");
    expect(refused(["watch", "resolve-held", "c1", "r1"])).toContain("--push or --drop");
    expect(refused(["watch", "resolve-held", "c1", "r1", "--push", "--drop"])).toContain(
      "not both",
    );
  });
});

describe("flightdeckd watch settings with a patch (issue #3539)", () => {
  test("one flag changes that field only, and the saved settings are printed", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["watch", "settings", "api", "--max-rounds", "4"], daemon.port);
    expect(run.code).toBe(0);
    expect(run.out[0]).toBe("api: PR watch settings");
    expect(run.out).toContain("max-rounds: 4");
    expect(callsOf(daemon, "watch.settings")).toEqual([
      { projectId: "p1", patch: { maxRounds: 4 } },
    ]);
  });

  test("every flag fills its field; none and a repeat of a list build the value", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      [
        "watch",
        "settings",
        "p1",
        "--disable",
        "--check",
        "bun test",
        "--check",
        "bun run lint",
        "--check-timeout-min",
        "20",
        "--budget-usd",
        "2.5",
        "--max-turns",
        "none",
        "--persona",
        "qa",
        "--max-failures",
        "3",
        "--daily-usd",
        "none",
        "--check-rounds",
        "2",
        "--check-env",
        "JAVA_HOME",
        "--check-env",
        "GOPATH",
        "--check-loop-default",
        "on",
        "--drift-allow",
        "bun.lock",
        "--json",
      ],
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(callsOf(daemon, "watch.settings")).toEqual([
      {
        projectId: "p1",
        patch: {
          enabled: false,
          checks: ["bun test", "bun run lint"],
          checkTimeoutMin: 20,
          budgetUsd: 2.5,
          maxTurns: null,
          persona: "qa",
          maxFailures: 3,
          dailyUsd: null,
          checkRounds: 2,
          checkEnv: ["JAVA_HOME", "GOPATH"],
          checkLoopDefault: true,
          driftAllow: ["bun.lock"],
        },
      },
    ]);
    expect(printed(run.out)).toMatchObject({ maxRounds: 4, checkEnv: null });
  });

  test("the clear flags empty a list, and the equals form of a flag is read", async () => {
    const daemon = fakeDaemon(OPEN);
    await flightdeckd(
      [
        "watch",
        "settings",
        "p1",
        "--clear-checks",
        "--clear-check-env",
        "--clear-drift-allow",
        "--max-rounds=2",
      ],
      daemon.port,
    );
    expect(callsOf(daemon, "watch.settings")).toEqual([
      { projectId: "p1", patch: { checks: [], checkEnv: [], driftAllow: [], maxRounds: 2 } },
    ]);
  });

  test("a check a shell would read, or a secret's name, is exit 1 and nothing reaches the daemon", async () => {
    const daemon = fakeDaemon(OPEN);
    const shell = await flightdeckd(
      ["watch", "settings", "api", "--check", "bun test; rm -rf x"],
      daemon.port,
    );
    const secret = await flightdeckd(
      ["watch", "settings", "api", "--check-env", "GITHUB_TOKEN"],
      daemon.port,
    );
    expect([shell.code, secret.code]).toEqual([1, 1]);
    expect(shell.err.join("\n")).toContain("--check: a check is a command and its arguments");
    expect(secret.err.join("\n")).toContain(
      "--check-env: a variable name, not one shaped like a secret",
    );
    expect(daemon.calls.filter((c) => c.type !== "hello")).toEqual([]);
  });

  test("a number outside its limit, a word where a number goes, and a flag typed twice are refused", () => {
    expect(refused(["watch", "settings", "api", "--max-rounds", "11"])).toContain("--max-rounds");
    expect(refused(["watch", "settings", "api", "--max-rounds", "x"])).toContain("--max-rounds");
    expect(refused(["watch", "settings", "api", "--budget-usd", "0"])).toContain("--budget-usd");
    expect(refused(["watch", "settings", "api", "--max-turns", "1.5"])).toContain("--max-turns");
    expect(refused(["watch", "settings", "api", "--check-loop-default", "maybe"])).toContain(
      "--check-loop-default",
    );
    expect(
      refused(["watch", "settings", "api", "--max-rounds", "2", "--max-rounds", "3"]),
    ).toContain("once");
    expect(refused(["watch", "settings", "api", "--enable", "--disable"])).toContain(
      "not more than one",
    );
  });

  test("a clear flag and the flag that adds to its list are refused in either order", () => {
    for (const [clear, add] of [
      ["--clear-drift-allow", "--drift-allow"],
      ["--clear-check-env", "--check-env"],
    ] as const) {
      const value = add === "--check-env" ? "HOME" : "a";
      expect(refused(["watch", "settings", "p", add, value, clear])).toContain("not with");
      expect(refused(["watch", "settings", "p", clear, add, value])).toContain("not with");
    }
  });

  test("a far host's refusal of a field it may not change is exit 1 with the daemon's line", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "watch.settings": () => ({
        error: { code: "transport_refused", message: "watch.settings needs a near connection" },
      }),
    });
    const run = await flightdeckd(["watch", "settings", "api", "--check", "bun test"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("watch.settings needs a near connection");
  });

  test("a silent daemon leaves a patch unknown, and no daemon is exit 2", async () => {
    const silent = fakeDaemon({ "project.list": OPEN["project.list"] as never });
    const result = await runWatchCli(
      { action: "settings", target: "api", patch: { maxRounds: 4 } },
      config(silent.port),
      { timeoutMs: 200 },
    );
    expect(result.code).toBe(2);
    expect(result.err.join("\n")).toContain("may or may not have been");
    const gone = fakeDaemon({ ...OPEN, "watch.settings": () => CLOSE });
    const closed = await flightdeckd(["watch", "settings", "api", "--max-rounds", "4"], gone.port);
    expect(closed.code).toBe(2);
  });
});

describe("the flags of the watch write verbs stay with their verb (issue #3539)", () => {
  test("a settings flag on another verb, and a set flag on settings, is refused", () => {
    expect(refused(["watch", "get", "c1", "--max-rounds", "3"])).toContain(
      "this flag only applies to flightdeckd watch settings",
    );
    expect(refused(["watch", "set", "c1", "--check", "bun test"])).toContain(
      "this flag only applies to flightdeckd watch settings",
    );
    expect(refused(["watch", "settings", "api", "--default"])).toContain(
      "this flag only applies to flightdeckd watch set",
    );
    expect(refused(["watch", "settings", "api", "--rounds", "2"])).toContain(
      "this flag only applies to flightdeckd watch extend",
    );
    expect(refused(["watch", "extend", "c1", "--rounds", "2", "--push"])).toContain(
      "this flag only applies to flightdeckd watch resolve-held",
    );
  });

  test("the flags the card and team commands share still belong to them", () => {
    expect(parseArgs(["card", "check-loop", "c1", "on", "--rounds", "2"])).toMatchObject({
      command: "card",
      rounds: 2,
    });
    expect(parseArgs(["team", "update", "t1", "--check", "bun test"])).toMatchObject({
      command: "team",
      teamChecks: ["bun test"],
    });
  });
});
