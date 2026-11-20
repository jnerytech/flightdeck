import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { TeamInfo } from "@flightdeck/protocol";
import { parseArgs } from "../../src/main.ts";
import { addMemberPayload, updatePayload } from "../../src/teams/domain/team-change.ts";
import type { TeamCliArgs } from "../../src/teams/domain/team-cli-view.ts";
import { runTeamCli } from "../../src/teams/team-cli.ts";
import {
  config,
  fakeDaemon,
  type Handlers,
  project,
  stopAll,
  TOKEN,
} from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const member = (name: string, role: "coordinator" | "worker", over = {}) => ({
  name,
  role,
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

/** A team as the daemon answers a change: the coordinator and w1 run, w2's card waits in the run queue. */
const team = (over: Partial<TeamInfo> = {}): TeamInfo => ({
  id: "t9",
  name: "Fix the login",
  projectId: "p1",
  goal: "Fix the login",
  coordinator: "s1",
  members: [
    member("lead", "coordinator", { sessionId: "s1", sessionState: "running" }),
    member("w1", "worker", { cardId: "c1", sessionId: "s2", sessionState: "running" }),
    member("w2", "worker", { cardId: "c2" }),
  ],
  checks: [],
  state: "active",
  pausedBy: null,
  instructionsVersion: "v1",
  createdAt: "2026-11-20T10:00:00Z",
  ...over,
});

const HANDLERS: Handlers = {
  "project.list": () => ({ projects: [project("p1", "api")], maxParallelRuns: 2 }),
  "teams.update": () => team(),
  "teams.delete": () => team({ state: "closed" }),
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

/** What a refused call throws, as its message. */
function refusal(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

describe("the teams.update payload of team update (issue #3455)", () => {
  const base: TeamCliArgs = { action: "update", id: "t9" };

  test("only what was asked is sent: a goal", () => {
    expect(updatePayload({ ...base, goal: "Ship the login 🚀 in São Paulo" })).toEqual({
      team: "t9",
      goal: "Ship the login 🚀 in São Paulo",
    });
  });

  test("a goal, the checks and a member's persona go together", () => {
    expect(
      updatePayload({
        ...base,
        goal: "g",
        checks: ["bun test", "bun run lint"],
        persona: "w1=reviewer",
      }),
    ).toEqual({
      team: "t9",
      goal: "g",
      checks: ["bun test", "bun run lint"],
      persona: { member: "w1", persona: "reviewer" },
    });
  });

  test("--clear-checks sends an empty list", () => {
    expect(updatePayload({ ...base, clearChecks: true })).toEqual({ team: "t9", checks: [] });
  });

  test("a persona left empty is the default one", () => {
    expect(updatePayload({ ...base, persona: "w1=" })).toEqual({
      team: "t9",
      persona: { member: "w1", persona: null },
    });
  });

  test("a member whose name has an equals sign keeps it after the first one", () => {
    expect(updatePayload({ ...base, persona: "a b=c=d" })).toEqual({
      team: "t9",
      persona: { member: "a b", persona: "c=d" },
    });
  });

  test("nothing to change is refused", () => {
    expect(refusal(() => updatePayload(base))).toContain("nothing to change");
  });

  test("--check and --clear-checks together are refused", () => {
    expect(refusal(() => updatePayload({ ...base, checks: ["x"], clearChecks: true }))).toContain(
      "--check or --clear-checks, not both",
    );
  });

  test("a persona that is not member=persona is refused", () => {
    for (const bad of ["reviewer", "=reviewer", " =reviewer"])
      expect(refusal(() => updatePayload({ ...base, persona: bad }))).toContain("member=persona");
  });
});

describe("the addMember payload of team add-member (issue #3455)", () => {
  const base: TeamCliArgs = { action: "add-member", id: "t9" };

  test("a spec sets the persona, model, effort and mode of the one worker", () => {
    expect(addMemberPayload({ ...base, spec: "reviewer:opus:high:plan" })).toEqual({
      team: "t9",
      addMember: { persona: "reviewer", model: "opus", effort: "high", permission: "plan" },
    });
  });

  test("no spec adds a default worker, and an empty part keeps its default", () => {
    expect(addMemberPayload(base)).toEqual({ team: "t9", addMember: {} });
    expect(addMemberPayload({ ...base, spec: "reviewer::high" })).toEqual({
      team: "t9",
      addMember: { persona: "reviewer", effort: "high" },
    });
  });
});

describe("team update (issue #3455)", () => {
  const args: TeamCliArgs = { action: "update", id: "t9", goal: "New goal", checks: ["bun test"] };

  test("sends the change and says the team as it is now", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await run(args, daemon);
    expect(result.code).toBe(0);
    expect(result.out).toEqual(["updated t9  Fix the login  active  2 workers"]);
    expect(sent(daemon, "teams.update")).toEqual({
      team: "t9",
      goal: "New goal",
      checks: ["bun test"],
    });
  });

  test("a change with nothing in it is exit 1 and sends nothing", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await run({ action: "update", id: "t9" }, daemon);
    expect(result.code).toBe(1);
    expect(text(result)).toContain("nothing to change");
    expect(sent(daemon, "teams.update")).toBeUndefined();
  });

  test("a closed or unknown team is exit 1 with the daemon's reason", async () => {
    const daemon = fakeDaemon({
      ...HANDLERS,
      "teams.update": () => ({ error: { code: "team_closed", message: "team t9 is closed" } }),
    });
    const result = await run(args, daemon);
    expect(result.code).toBe(1);
    expect(text(result)).toContain("team t9 is closed");
  });

  test("an update that got no answer says its result is unknown", async () => {
    const result = await run(args, fakeDaemon({}), 200);
    expect(result.code).toBe(2);
    expect(text(result)).toContain("may or may not have been applied");
    expect(text(result)).toContain("team show");
  });
});

describe("team delete (issue #3455)", () => {
  const args: TeamCliArgs = { action: "delete", id: "t9", confirm: true };

  test("needs --confirm and sends nothing without it", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await run({ action: "delete", id: "t9" }, daemon);
    expect(result.code).toBe(1);
    expect(text(result)).toContain("team delete needs --confirm");
    expect(sent(daemon, "teams.delete")).toBeUndefined();
  });

  test("deletes the team and does not send the confirmation, which the daemon has no field for", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await run(args, daemon);
    expect(result.code).toBe(0);
    expect(result.out).toEqual(["deleted t9  Fix the login  closed  2 workers"]);
    expect(sent(daemon, "teams.delete")).toEqual({ team: "t9" });
  });

  test("an open team or a member at work is exit 1 with the daemon's reason", async () => {
    const daemon = fakeDaemon({
      ...HANDLERS,
      "teams.delete": () => ({ error: { code: "team_open", message: "close the team first" } }),
    });
    const result = await run(args, daemon);
    expect(result.code).toBe(1);
    expect(text(result)).toContain("close the team first");
  });

  test("a delete that got no answer says its result is unknown", async () => {
    const result = await run(args, fakeDaemon({}), 200);
    expect(result.code).toBe(2);
    expect(text(result)).toContain("may or may not have been deleted");
  });
});

describe("team add-member (issue #3455)", () => {
  const args: TeamCliArgs = { action: "add-member", id: "t9", spec: "reviewer:::plan" };

  test("adds one worker and says which workers wait in the run queue", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await run(args, daemon);
    expect(result.code).toBe(0);
    expect(result.out).toEqual([
      "member added to t9  Fix the login  active  2 workers",
      "w2  waits in the run queue (card c2)",
    ]);
    expect(sent(daemon, "teams.update")).toEqual({
      team: "t9",
      addMember: { persona: "reviewer", permission: "plan" },
    });
  });

  test("says only the new worker waits in the run queue, not the ones that already did", async () => {
    const daemon = fakeDaemon({
      ...HANDLERS,
      "teams.update": () =>
        team({
          members: [
            member("lead", "coordinator", { sessionId: "s1" }),
            member("w1", "worker", { cardId: "c1" }),
            member("w2", "worker", { cardId: "c2", sessionId: "s3" }),
          ],
        }),
    });
    const result = await run(args, daemon);
    expect(result.out).toEqual(["member added to t9  Fix the login  active  2 workers"]);
  });

  test("a bad spec is exit 1 and sends nothing", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await run({ ...args, spec: "dev:opus:ultra" }, daemon);
    expect(result.code).toBe(1);
    expect(text(result)).toContain("effort");
    expect(sent(daemon, "teams.update")).toBeUndefined();
  });

  test("a worker on bypassPermissions needs --confirm, as the app asks again", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const bypass = { ...args, spec: "dev:::bypassPermissions" };
    const refused = await run(bypass, daemon);
    expect(refused.code).toBe(1);
    expect(text(refused)).toContain("--confirm");
    expect(sent(daemon, "teams.update")).toBeUndefined();
    const allowed = await run({ ...bypass, confirm: true }, daemon);
    expect(allowed.code).toBe(0);
    expect(sent(daemon, "teams.update")).toEqual({
      team: "t9",
      addMember: { persona: "dev", permission: "bypassPermissions" },
    });
  });

  test("a paused team or a refused mode is exit 1 with the daemon's reason", async () => {
    const daemon = fakeDaemon({
      ...HANDLERS,
      "teams.update": () => ({ error: { code: "team_paused", message: "the team is paused" } }),
    });
    const result = await run(args, daemon);
    expect(result.code).toBe(1);
    expect(text(result)).toContain("the team is paused");
  });

  test("an add that got no answer says its result is unknown", async () => {
    const result = await run(args, fakeDaemon({}), 200);
    expect(result.code).toBe(2);
    expect(text(result)).toContain("may or may not have been added");
  });

  test("the token of the config is in none of the output", async () => {
    const daemon = fakeDaemon({
      ...HANDLERS,
      "teams.update": () => ({ error: { code: "x", message: TOKEN } }),
    });
    const result = await run(args, daemon);
    expect(result.code).toBe(1);
    expect(text(result)).not.toContain(TOKEN);
  });
});

describe("team remove-member (issue #3455)", () => {
  const args: TeamCliArgs = { action: "remove-member", id: "t9", member: "w1", confirm: true };

  test("takes the member out and says the team as it is now", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await run(args, daemon);
    expect(result.code).toBe(0);
    expect(result.out).toEqual(["member removed from t9  Fix the login  active  2 workers"]);
    expect(sent(daemon, "teams.update")).toEqual({ team: "t9", removeMember: "w1" });
  });

  test("needs --confirm, as the app asks, and stops nothing without it", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await run({ action: "remove-member", id: "t9", member: "w1" }, daemon);
    expect(result.code).toBe(1);
    expect(text(result)).toContain("team remove-member needs --confirm");
    expect(sent(daemon, "teams.update")).toBeUndefined();
  });

  test("the coordinator or an unknown member is exit 1 with the daemon's reason", async () => {
    const daemon = fakeDaemon({
      ...HANDLERS,
      "teams.update": () => ({
        error: { code: "member_unknown", message: "no member w7 in the team" },
      }),
    });
    const result = await run({ ...args, member: "w7" }, daemon);
    expect(result.code).toBe(1);
    expect(text(result)).toContain("no member w7 in the team");
  });

  test("a remove that got no answer says its result is unknown", async () => {
    const result = await run(args, fakeDaemon({}), 200);
    expect(result.code).toBe(2);
    expect(text(result)).toContain("may or may not have been removed");
  });
});

describe("flightdeckd team update, delete, add-member and remove-member, as the terminal runs them (issue #3455)", () => {
  async function terminal(argv: string[]) {
    const daemon = fakeDaemon(HANDLERS);
    try {
      return { ...(await flightdeckd(argv, daemon.port)), daemon };
    } catch (error) {
      return { out: [], err: [String(error)], code: -1, daemon };
    }
  }

  test("each verb reaches the daemon with its payload and exits 0", async () => {
    const update = await terminal(["team", "update", "t9", "--goal", "New goal", "--check", "a"]);
    expect({ code: update.code, first: update.out[0] }).toEqual({
      code: 0,
      first: "updated t9  Fix the login  active  2 workers",
    });
    expect(sent(update.daemon, "teams.update")).toEqual({
      team: "t9",
      goal: "New goal",
      checks: ["a"],
    });
    const added = await terminal(["team", "add-member", "t9", "reviewer"]);
    expect(added.code).toBe(0);
    expect(sent(added.daemon, "teams.update")).toEqual({
      team: "t9",
      addMember: { persona: "reviewer" },
    });
    const removed = await terminal(["team", "remove-member", "t9", "w1", "--confirm"]);
    expect(removed.code).toBe(0);
    expect(sent(removed.daemon, "teams.update")).toEqual({ team: "t9", removeMember: "w1" });
    const deleted = await terminal(["team", "delete", "t9", "--confirm"]);
    expect(deleted.code).toBe(0);
    expect(sent(deleted.daemon, "teams.delete")).toEqual({ team: "t9" });
  });

  test("a delete without --confirm is exit 1 and nothing is sent", async () => {
    const result = await terminal(["team", "delete", "t9"]);
    expect(result.code).toBe(1);
    expect(text(result)).toContain("team delete needs --confirm");
    expect(sent(result.daemon, "teams.delete")).toBeUndefined();
  });
});

describe("team update, delete, add-member and remove-member: the arguments (issue #3455)", () => {
  test("each verb takes its team and operands", () => {
    expect(
      parsed(["team", "update", "t9", "--goal", "g", "--check", "a", "--check", "b"]),
    ).toMatchObject({
      action: "update",
      teamId: "t9",
      teamGoal: "g",
      teamChecks: ["a", "b"],
    });
    expect(parsed(["team", "update", "t9", "--clear-checks", "--persona", "w1=qa"])).toMatchObject({
      teamClearChecks: true,
      teamPersona: "w1=qa",
    });
    expect(parsed(["team", "add-member", "t9", "dev:opus"])).toMatchObject({
      action: "add-member",
      teamId: "t9",
      teamSpec: "dev:opus",
    });
    expect(parsed(["team", "add-member", "t9", "--json"])).toMatchObject({
      action: "add-member",
      teamId: "t9",
      json: true,
    });
    expect(parsed(["team", "remove-member", "t9", "w 1", "--confirm"])).toMatchObject({
      action: "remove-member",
      teamId: "t9",
      teamMember: "w 1",
      confirm: true,
    });
    expect(parsed(["team", "delete", "t9", "--confirm"])).toMatchObject({
      action: "delete",
      teamId: "t9",
      confirm: true,
    });
  });

  test("a flag given twice, or a goal flag on team new, is refused whatever its place", () => {
    expect(
      parsed(["team", "update", "t9", "--persona", "w1=a", "--persona", "w2=b"]),
    ).toMatchObject({ error: expect.stringContaining("--persona: once") });
    expect(parsed(["team", "update", "t9", "--goal", "a", "--goal", "b"])).toMatchObject({
      error: expect.stringContaining("--goal: once"),
    });
    for (const argv of [
      ["team", "new", "g", "--workers", "1", "--goal", "x"],
      ["--goal", "x", "team", "new", "g", "--workers", "1"],
    ])
      expect(parsed(argv)).toMatchObject({
        error: expect.stringContaining("this flag only applies to flightdeckd team update"),
      });
  });

  test("a missing team or member is refused", () => {
    for (const argv of [
      ["team", "update"],
      ["team", "delete"],
      ["team", "add-member"],
      ["team", "remove-member"],
      ["team", "remove-member", "t9"],
    ])
      expect(parsed(argv)).toMatchObject({ error: expect.stringContaining("missing the") });
  });

  test("a flag belongs to its verbs only", () => {
    for (const [argv, word] of [
      [["team", "update", "t9", "--confirm"], "team new, delete, add-member, remove-member"],
      [["team", "delete", "t9", "--goal", "g"], "team update"],
      [["team", "show", "t9", "--clear-checks"], "team update"],
      [["team", "list", "--persona", "w1=x"], "team update"],
      [["team", "remove-member", "t9", "w1", "--check", "a"], "team new, update"],
    ] as const)
      expect(parsed([...argv])).toMatchObject({
        error: expect.stringContaining(`this flag only applies to flightdeckd ${word}`),
      });
    expect(parsed(["card", "list", "--goal", "g"])).toMatchObject({
      error: expect.stringContaining("--goal"),
    });
  });
});
