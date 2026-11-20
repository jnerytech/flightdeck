import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { TeamInfo, TeamStatus } from "@flightdeck/protocol";
import { parseArgs } from "../../src/main.ts";
import type { TeamCliArgs } from "../../src/teams/domain/team-cli-view.ts";
import { runTeamCli } from "../../src/teams/team-cli.ts";
import {
  config,
  fakeDaemon,
  type Handlers,
  HOST,
  stopAll,
  TOKEN,
} from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const member = (name: string, role: "coordinator" | "worker", over = {}) => ({
  name,
  role,
  persona: role === "coordinator" ? "architect" : "developer",
  model: null,
  permission: null,
  cardId: null,
  sessionId: null,
  address: null,
  sessionState: null,
  number: null,
  ...over,
});

const team = (id: string, over: Partial<TeamInfo> = {}): TeamInfo => ({
  id,
  name: `team ${id}`,
  projectId: "p1",
  goal: "Fix the login",
  coordinator: "lead",
  members: [member("lead", "coordinator"), member("w1", "worker"), member("w2", "worker")],
  checks: [],
  state: "active",
  pausedBy: null,
  instructionsVersion: "v1",
  createdAt: "2026-11-20T10:00:00Z",
  ...over,
});

const TEAMS = [
  team("t1", { name: "Login fix" }),
  team("t2", {
    name: "Docs",
    projectId: "p2",
    state: "paused",
    pausedBy: "quota",
    members: [member("lead", "coordinator"), member("w1", "worker")],
  }),
  team("t3", {
    name: "Old",
    projectId: "p2",
    state: "closed",
    members: [member("lead", "coordinator")],
  }),
];

const status = (over: Partial<TeamStatus> = {}): TeamStatus => ({
  team: team("t1", { name: "Login fix" }),
  members: [
    {
      ...member("lead", "coordinator", { sessionState: "running" }),
      lastReport: null,
      sent: 4,
      received: 2,
    },
    {
      ...member("w1", "worker", { sessionState: "idle", cardId: "c7" }),
      lastReport: { text: "login form done", at: "2026-11-20T11:00:00Z" },
      sent: 1,
      received: 3,
    },
  ],
  messages: 6,
  outcome: null,
  ...over,
});

const HANDLERS: Handlers = {
  "project.list": HOST["project.list"] as Handlers[string],
  "teams.list": ({ projectId }) => ({
    teams: TEAMS.filter((t) => projectId === undefined || t.projectId === projectId),
  }),
  "teams.status": ({ team: id }) =>
    id === "t1" ? status() : { error: { code: "not_found", message: `no team "${String(id)}"` } },
};

const text = (r: { out: string[]; err: string[] }) => [...r.out, ...r.err].join("\n");
/** True when the text holds a control (but the line break) or bidi-override character: what could drive a terminal. */
const drivesTerminal = (value: string) =>
  [...value].some((c) => {
    const code = c.charCodeAt(0);
    return (
      (code < 0x20 && code !== 0x0a) ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0x202a && code <= 0x202e)
    );
  });
/** The JSON the command printed, or null, so an empty or broken output is an assertion and not a throw. */
const printed = (lines: string[]) => {
  try {
    return JSON.parse(lines.join("\n"));
  } catch {
    return null;
  }
};
const run = (args: TeamCliArgs, daemon: { port: number }) => runTeamCli(args, config(daemon.port));

/** The parsed arguments, or the refusal as `{ error }`, so a wrong parse is an assertion and not a throw. */
function parsed(argv: string[]) {
  try {
    return parseArgs(argv);
  } catch (error) {
    return { error: (error as Error).message };
  }
}

describe("team list (issue #3455)", () => {
  test("lists every team, one line each, with its state and how many workers it has", async () => {
    const result = await run({ action: "list" }, fakeDaemon(HANDLERS));
    expect(result.code).toBe(0);
    expect(result.err).toEqual([]);
    expect(result.out).toEqual([
      "t1  Login fix  active  2 workers",
      "t2  Docs  paused by quota  1 worker",
      "t3  Old  closed  0 workers",
    ]);
  });

  test("--project, by name or by id, asks for the teams of that project only", async () => {
    for (const wanted of ["web", "p2"]) {
      const daemon = fakeDaemon(HANDLERS);
      const result = await run({ action: "list", project: wanted }, daemon);
      expect(result.out.map((line) => line.split("  ")[0])).toEqual(["t2", "t3"]);
      expect(daemon.calls.filter((c) => c.type === "teams.list").map((c) => c.payload)).toEqual([
        { projectId: "p2" },
      ]);
    }
  });

  test("--project naming no project is exit 1 with the projects the host has, and asks for no team", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await run({ action: "list", project: "nope" }, daemon);
    expect(result.code).toBe(1);
    expect(text(result)).toContain('no project named "nope"');
    expect(daemon.calls.filter((c) => c.type === "teams.list")).toEqual([]);
  });

  test("without --project the daemon is asked for every team", async () => {
    const daemon = fakeDaemon(HANDLERS);
    await run({ action: "list" }, daemon);
    expect(daemon.calls.filter((c) => c.type === "teams.list").map((c) => c.payload)).toEqual([{}]);
  });

  test("--json prints the teams the daemon returned", async () => {
    const result = await run({ action: "list", json: true }, fakeDaemon(HANDLERS));
    expect(result.code).toBe(0);
    expect(printed(result.out)).toEqual(TEAMS);
  });

  test("a host with no team prints nothing and exits 0", async () => {
    const result = await run(
      { action: "list" },
      fakeDaemon({ "teams.list": () => ({ teams: [] }) }),
    );
    expect(result).toEqual({ code: 0, out: [], err: [] });
  });

  test("a name the team or the daemon wrote cannot drive the terminal", async () => {
    const hostile = team("t9", { name: `Login\u001b[2J fix${String.fromCharCode(0x202e)}` });
    const result = await run(
      { action: "list" },
      fakeDaemon({ "teams.list": () => ({ teams: [hostile] }) }),
    );
    expect(drivesTerminal(text(result))).toBe(false);
    expect(result.out).toHaveLength(1);
    expect(result.out[0]).toContain("Login");
  });

  test("no daemon on the port is exit 2 with one line saying so", async () => {
    const result = await run({ action: "list" }, { port: 1 });
    expect(result.code).toBe(2);
    expect(result.err).toHaveLength(1);
  });
});

describe("team show (issue #3455)", () => {
  test("asks teams.status for that team without naming an identity", async () => {
    const daemon = fakeDaemon(HANDLERS);
    await run({ action: "show", id: "t1" }, daemon);
    expect(daemon.calls.filter((c) => c.type === "teams.status").map((c) => c.payload)).toEqual([
      { team: "t1" },
    ]);
  });

  test("prints the team, its goal and one line per member with its state and last report", async () => {
    const result = await run({ action: "show", id: "t1" }, fakeDaemon(HANDLERS));
    expect(result.code).toBe(0);
    expect(result.out).toEqual([
      "t1  Login fix",
      "state: active",
      "goal: Fix the login",
      "messages: 6",
      "lead  coordinator  architect  running  sent 4, received 2",
      "w1  worker  developer  idle  card c7  sent 1, received 3",
      "  last report: login form done",
    ]);
  });

  test("a paused team says who paused it, and a report of the team's outcome is shown", async () => {
    const paused = status({
      team: team("t1", { state: "paused", pausedBy: "user" }),
      outcome: { text: "all checks pass", at: "2026-11-20T12:00:00Z", done: true },
    });
    const result = await run(
      { action: "show", id: "t1" },
      fakeDaemon({ "teams.status": () => paused }),
    );
    expect(result.out).toContain("state: paused by user");
    expect(result.out).toContain("outcome (done): all checks pass");
  });

  test("text a session wrote cannot drive the terminal", async () => {
    const hostile = status({
      outcome: { text: "done\u001b]0;owned\u0007", at: "2026-11-20T12:00:00Z", done: false },
    });
    const result = await run(
      { action: "show", id: "t1" },
      fakeDaemon({ "teams.status": () => hostile }),
    );
    expect(drivesTerminal(text(result))).toBe(false);
    expect(result.out.join("\n")).toContain("outcome (not done): done");
  });

  test("--json prints the status the daemon returned", async () => {
    const result = await run({ action: "show", id: "t1", json: true }, fakeDaemon(HANDLERS));
    expect(printed(result.out)).toEqual(status());
  });

  test("an unknown team is exit 1 with the daemon's reason", async () => {
    const result = await run({ action: "show", id: "nope" }, fakeDaemon(HANDLERS));
    expect(result.code).toBe(1);
    expect(result.out).toEqual([]);
    expect(text(result)).toContain('no team "nope"');
  });

  test("the token of the config is in none of the output", async () => {
    const daemon = fakeDaemon({ "teams.status": () => ({ error: { code: "x", message: TOKEN } }) });
    const result = await run({ action: "show", id: "t1" }, daemon);
    expect(result.code).toBe(1);
    expect(text(result)).not.toContain(TOKEN);
  });
});

describe("flightdeckd team, as the terminal runs it (issue #3455)", () => {
  async function terminal(argv: string[]) {
    const daemon = fakeDaemon(HANDLERS);
    try {
      return await flightdeckd(argv, daemon.port);
    } catch (error) {
      return { out: [], err: [String(error)], code: -1 };
    }
  }

  test("team list prints the teams and exits 0", async () => {
    const result = await terminal(["team", "list"]);
    expect({ code: result.code, first: result.out[0] }).toEqual({
      code: 0,
      first: "t1  Login fix  active  2 workers",
    });
  });

  test("team show <id> --json prints the status", async () => {
    const result = await terminal(["team", "show", "t1", "--json"]);
    expect(result.code).toBe(0);
    expect(printed(result.out)?.team?.id).toBe("t1");
  });

  test("team show of an unknown team exits 1 with the daemon's reason", async () => {
    const result = await terminal(["team", "show", "nope"]);
    expect({ code: result.code, said: text(result).includes('no team "nope"') }).toEqual({
      code: 1,
      said: true,
    });
  });
});

describe("team: the arguments (issue #3455)", () => {
  test("list and show, with what each takes", () => {
    expect(parsed(["team", "list"])).toMatchObject({ command: "team", action: "list" });
    expect(parsed(["team", "list", "--project", "p1", "--json"])).toMatchObject({
      action: "list",
      project: "p1",
      json: true,
    });
    expect(parsed(["team", "show", "t1", "--json"])).toMatchObject({
      command: "team",
      action: "show",
      teamId: "t1",
      json: true,
    });
  });

  test("a missing or unknown action and a show with no team are refused with the usage", () => {
    expect(parsed(["team"])).toMatchObject({
      error: expect.stringContaining("invalid team action"),
    });
    expect(parsed(["team", "frobnicate"])).toMatchObject({
      error: expect.stringContaining("invalid team action"),
    });
    expect(parsed(["team", "show"])).toMatchObject({
      error: expect.stringContaining("the team"),
    });
  });

  test("--host is refused on team: it reaches this machine's daemon only", () => {
    expect(parsed(["team", "list", "--host", "server"])).toMatchObject({
      error: expect.stringContaining("--host: this flag only applies"),
    });
  });
});
