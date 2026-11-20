import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { TeamInfo } from "@flightdeck/protocol";
import { parseArgs } from "../../src/main.ts";
import type { TeamCliArgs } from "../../src/teams/domain/team-cli-view.ts";
import { runTeamCli } from "../../src/teams/team-cli.ts";
import { config, fakeDaemon, type Handlers, stopAll, TOKEN } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const worker = (name: string, over = {}) => ({
  name,
  role: "worker" as const,
  persona: null,
  model: null,
  permission: null,
  cardId: null,
  sessionId: null,
  address: null,
  sessionState: null,
  number: null,
  ...over,
});

/** A team as the daemon answers a state change. */
const team = (over: Partial<TeamInfo> = {}): TeamInfo => ({
  id: "t9",
  name: "Fix the login",
  projectId: "p1",
  goal: "Fix the login",
  coordinator: "s1",
  members: [
    { ...worker("lead", { sessionId: "s1", sessionState: "running" }), role: "coordinator" },
    worker("w1", { cardId: "c1", sessionId: "s2", sessionState: "running" }),
  ],
  checks: [],
  state: "active",
  pausedBy: null,
  instructionsVersion: "v1",
  createdAt: "2026-11-20T10:00:00Z",
  ...over,
});

const HANDLERS: Handlers = {
  "teams.pause": () => team({ state: "paused", pausedBy: "user" }),
  "teams.resume": () => team(),
  "teams.close": () => team({ state: "closed" }),
  "teams.message": () => ({ delivered: 2, refused: 1 }),
};

const text = (r: { out: string[]; err: string[] }) => [...r.out, ...r.err].join("\n");
const sent = (daemon: { calls: Array<{ type: string; payload: unknown }> }, type: string) =>
  daemon.calls.find((call) => call.type === type)?.payload;
const run = (args: TeamCliArgs, daemon: { port: number }, timeoutMs?: number) =>
  runTeamCli(args, config(daemon.port), timeoutMs ? { timeoutMs } : {});

function parsed(argv: string[]) {
  try {
    return parseArgs(argv);
  } catch (error) {
    return { error: (error as Error).message };
  }
}

describe("team pause and resume (issue #3455)", () => {
  test("pause sends the team and says the team as it is now", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await run({ action: "pause", id: "t9" }, daemon);
    expect({ code: result.code, out: result.out, sent: sent(daemon, "teams.pause") }).toEqual({
      code: 0,
      out: ["paused t9  Fix the login  paused by user  1 worker"],
      sent: { team: "t9" },
    });
  });

  test("resume sends the team and says the team as it is now", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await run({ action: "resume", id: "t9" }, daemon);
    expect({ code: result.code, out: result.out, sent: sent(daemon, "teams.resume") }).toEqual({
      code: 0,
      out: ["resumed t9  Fix the login  active  1 worker"],
      sent: { team: "t9" },
    });
  });

  test("a closed or unknown team is exit 1 with the daemon's reason", async () => {
    const daemon = fakeDaemon({
      "teams.pause": () => ({ error: { code: "team_closed", message: "team t9 is closed" } }),
    });
    const result = await run({ action: "pause", id: "t9" }, daemon);
    expect(result.code).toBe(1);
    expect(text(result)).toContain("team t9 is closed");
  });

  test("a pause or a resume that got no answer says its result is unknown", async () => {
    for (const action of ["pause", "resume"] as const) {
      const result = await run({ action, id: "t9" }, fakeDaemon({}), 200);
      expect(result.code).toBe(2);
      expect(text(result)).toContain("may or may not have been");
      expect(text(result)).toContain("team show");
    }
  });
});

describe("team close (issue #3455)", () => {
  test("needs --confirm and sends nothing without it", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await run({ action: "close", id: "t9" }, daemon);
    expect(result.code).toBe(1);
    expect(text(result)).toContain("team close needs --confirm");
    expect(sent(daemon, "teams.close")).toBeUndefined();
  });

  test("closes the team and sends the confirmation, which the daemon asks for", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await run({ action: "close", id: "t9", confirm: true }, daemon);
    expect({ code: result.code, out: result.out, sent: sent(daemon, "teams.close") }).toEqual({
      code: 0,
      out: ["closed t9  Fix the login  closed  1 worker"],
      sent: { team: "t9", confirm: true },
    });
  });

  test("a close that got no answer says its result is unknown", async () => {
    const result = await run({ action: "close", id: "t9", confirm: true }, fakeDaemon({}), 200);
    expect(result.code).toBe(2);
    expect(text(result)).toContain("may or may not have been closed");
  });
});

describe("team message (issue #3455)", () => {
  const args: TeamCliArgs = { action: "message", id: "t9", text: "Stop and report" };

  test("sends the text to every member and says how many got it", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await run(args, daemon);
    expect({ code: result.code, out: result.out, sent: sent(daemon, "teams.message") }).toEqual({
      code: 0,
      out: ["message to t9: 2 delivered, 1 refused"],
      sent: { team: "t9", text: "Stop and report" },
    });
  });

  test("--json prints the daemon's answer", async () => {
    const result = await run({ ...args, json: true }, fakeDaemon(HANDLERS));
    expect(JSON.parse(result.out.join("\n"))).toEqual({ delivered: 2, refused: 1 });
  });

  test("a blank text is exit 1 and sends nothing", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await run({ ...args, text: "  " }, daemon);
    expect(result.code).toBe(1);
    expect(text(result)).toContain("message text");
    expect(sent(daemon, "teams.message")).toBeUndefined();
  });

  test("a closed team is exit 1 with the daemon's reason", async () => {
    const daemon = fakeDaemon({
      "teams.message": () => ({ error: { code: "team_closed", message: "team t9 is closed" } }),
    });
    const result = await run(args, daemon);
    expect(result.code).toBe(1);
    expect(text(result)).toContain("team t9 is closed");
  });

  test("a message that got no answer says its delivery is unknown", async () => {
    const result = await run(args, fakeDaemon({}), 200);
    expect(result.code).toBe(2);
    expect(text(result)).toContain("may or may not have been delivered");
  });

  test("the token of the config is in none of the output", async () => {
    const result = await run(args, fakeDaemon(HANDLERS));
    expect(text(result)).not.toContain(TOKEN);
  });
});

describe("flightdeckd team pause, resume, close and message, as the terminal runs them (issue #3455)", () => {
  async function terminal(argv: string[]) {
    const daemon = fakeDaemon(HANDLERS);
    try {
      return { ...(await flightdeckd(argv, daemon.port)), daemon };
    } catch (error) {
      return { out: [], err: [String(error)], code: -1, daemon };
    }
  }

  test("each verb reaches the daemon with its payload and exits 0", async () => {
    const paused = await terminal(["team", "pause", "t9"]);
    expect([paused.code, sent(paused.daemon, "teams.pause")]).toEqual([0, { team: "t9" }]);
    const resumed = await terminal(["team", "resume", "t9"]);
    expect([resumed.code, sent(resumed.daemon, "teams.resume")]).toEqual([0, { team: "t9" }]);
    const closed = await terminal(["team", "close", "t9", "--confirm"]);
    expect([closed.code, sent(closed.daemon, "teams.close")]).toEqual([
      0,
      { team: "t9", confirm: true },
    ]);
    const message = await terminal(["team", "message", "t9", "Stop and report"]);
    expect([message.code, sent(message.daemon, "teams.message")]).toEqual([
      0,
      { team: "t9", text: "Stop and report" },
    ]);
  });

  test("a close without --confirm is exit 1 and nothing is sent", async () => {
    const result = await terminal(["team", "close", "t9"]);
    expect(result.code).toBe(1);
    expect(sent(result.daemon, "teams.close")).toBeUndefined();
  });
});

describe("team pause, resume, close and message: the arguments (issue #3455)", () => {
  test("each verb takes its team, and message its text", () => {
    expect(parsed(["team", "pause", "t9"])).toMatchObject({ action: "pause", teamId: "t9" });
    expect(parsed(["team", "resume", "t9", "--json"])).toMatchObject({
      action: "resume",
      teamId: "t9",
      json: true,
    });
    expect(parsed(["team", "close", "t9", "--confirm"])).toMatchObject({
      action: "close",
      teamId: "t9",
      confirm: true,
    });
    expect(parsed(["team", "message", "t9", "Stop and report"])).toMatchObject({
      action: "message",
      teamId: "t9",
      teamText: "Stop and report",
    });
  });

  test("a missing team or text is refused", () => {
    expect(parsed(["team", "pause"])).toMatchObject({ error: expect.stringContaining("team") });
    expect(parsed(["team", "message", "t9"])).toMatchObject({
      error: expect.stringContaining("the text"),
    });
  });

  test("--confirm belongs to close, and the other verbs' flags are refused on these", () => {
    expect(parsed(["team", "pause", "t9", "--confirm"])).toMatchObject({
      error: expect.stringContaining("this flag only applies to flightdeckd team"),
    });
    expect(parsed(["team", "message", "t9", "hi", "--goal", "g"])).toMatchObject({
      error: expect.stringContaining("this flag only applies to flightdeckd team update"),
    });
  });
});
