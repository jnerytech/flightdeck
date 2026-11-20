import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { TeamInfo } from "@flightdeck/protocol";
import { parseArgs } from "../../src/main.ts";
import type { TeamCliArgs } from "../../src/teams/domain/team-cli-view.ts";
import { memberSpec, newTeamPayload } from "../../src/teams/domain/team-new.ts";
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

/** A team as `teams.create` answers it: the coordinator runs, w1 runs, w2's card waits in the run queue. */
const created = (over: Partial<TeamInfo> = {}): TeamInfo => ({
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

const ONE_PROJECT = { projects: [project("p1", "api")], maxParallelRuns: 2 };
const TWO_PROJECTS = { projects: [project("p1", "api"), project("p2", "web")], maxParallelRuns: 2 };

const HANDLERS: Handlers = {
  "project.list": () => ONE_PROJECT,
  "teams.create": () => created(),
};

const text = (r: { out: string[]; err: string[] }) => [...r.out, ...r.err].join("\n");
const sentCreate = (daemon: { calls: Array<{ type: string; payload: unknown }> }) =>
  daemon.calls.find((call) => call.type === "teams.create")?.payload;
const run = (args: TeamCliArgs, daemon: { port: number }, timeoutMs?: number) =>
  runTeamCli(args, config(daemon.port), timeoutMs ? { timeoutMs } : {});

/** The parsed arguments, or the refusal as `{ error }`, so a wrong parse is an assertion and not a throw. */
function parsed(argv: string[]) {
  try {
    return parseArgs(argv);
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/** What the call refuses with, or null, so a missing refusal is an assertion and not an uncaught pass. */
function refusal(call: () => unknown): string | null {
  try {
    call();
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

describe("a member spec is persona[:model[:effort[:mode]]] (issue #3455)", () => {
  test("every part, in order", () => {
    expect(memberSpec("developer:opus:high:acceptEdits")).toEqual({
      persona: "developer",
      model: "opus",
      effort: "high",
      permission: "acceptEdits",
    });
  });

  test("a part left empty keeps the default, and the whole spec may be empty", () => {
    expect(memberSpec("")).toEqual({});
    expect(memberSpec("::high")).toEqual({ effort: "high" });
    expect(memberSpec(":sonnet")).toEqual({ model: "sonnet" });
    expect(memberSpec(":::plan")).toEqual({ permission: "plan" });
    expect(memberSpec("reviewer:")).toEqual({ persona: "reviewer" });
  });

  test("an effort or a mode the app does not have is refused, saying which and what it takes", () => {
    expect(refusal(() => memberSpec("dev:opus:ultra"))).toContain("effort");
    expect(refusal(() => memberSpec("dev:opus:ultra"))).toContain("xhigh");
    expect(refusal(() => memberSpec("dev:opus:high:yolo"))).toContain("bypassPermissions");
  });

  test("a fifth part is refused, not dropped", () => {
    expect(refusal(() => memberSpec("dev:opus:high:plan:extra"))).toContain("at most 4 parts");
  });
});

describe("the teams.create payload of team new (issue #3455)", () => {
  const base = { action: "new", goal: "Fix the login" } as const;

  test("a goal and a worker count send only those", () => {
    expect(newTeamPayload({ ...base, workers: 2 }, "p1")).toEqual({
      projectId: "p1",
      goal: "Fix the login",
      workers: 2,
    });
  });

  test("the name and the checks are sent when set", () => {
    expect(
      newTeamPayload(
        { ...base, workers: 1, name: "Login", checks: ["bun test", "bun run lint"] },
        "p1",
      ),
    ).toEqual({
      projectId: "p1",
      goal: "Fix the login",
      workers: 1,
      name: "Login",
      checks: ["bun test", "bun run lint"],
    });
  });

  test("the coordinator spec sets its persona, model, effort and mode", () => {
    expect(
      newTeamPayload({ ...base, workers: 1, coordinator: "architect:opus:max:plan" }, "p1"),
    ).toEqual({
      projectId: "p1",
      goal: "Fix the login",
      workers: 1,
      coordinatorPersona: "architect",
      coordinatorModel: "opus",
      coordinatorEffort: "max",
      coordinatorPermission: "plan",
    });
  });

  test("each --worker is one worker, and a field only some set is null for the others, in worker order", () => {
    expect(
      newTeamPayload(
        {
          ...base,
          workerSpecs: ["developer:opus:high:acceptEdits", "reviewer:sonnet"],
        },
        "p1",
      ),
    ).toEqual({
      projectId: "p1",
      goal: "Fix the login",
      workers: 2,
      workerPersonas: ["developer", "reviewer"],
      workerModels: ["opus", "sonnet"],
      workerEfforts: ["high", null],
      workerPermissions: ["acceptEdits", null],
    });
  });

  test("workers that set no field send no array at all", () => {
    expect(newTeamPayload({ ...base, workerSpecs: ["", ""] }, "p1")).toEqual({
      projectId: "p1",
      goal: "Fix the login",
      workers: 2,
    });
  });

  test("a persona for some workers only is refused: the daemon takes a persona for each or none", () => {
    expect(
      refusal(() => newTeamPayload({ ...base, workerSpecs: ["developer", ":sonnet"] }, "p1")),
    ).toContain("persona");
  });

  test("the goal goes as typed, with accents and emoji", () => {
    const goal = "Corrigir o login 🚀 — açaí";
    expect(newTeamPayload({ action: "new", goal, workers: 1 }, "p1")).toMatchObject({ goal });
  });

  test("the worker count is 1 to 8, from --workers or from the --worker specs", () => {
    const specs = (n: number) => Array.from({ length: n }, () => "");
    for (const ok of [1, 8]) {
      expect(newTeamPayload({ ...base, workers: ok }, "p1")).toMatchObject({ workers: ok });
      expect(newTeamPayload({ ...base, workerSpecs: specs(ok) }, "p1")).toMatchObject({
        workers: ok,
      });
    }
    for (const bad of [0, 9]) {
      expect(refusal(() => newTeamPayload({ ...base, workers: bad }, "p1"))).toContain("1 to 8");
    }
    expect(refusal(() => newTeamPayload({ ...base, workerSpecs: specs(9) }, "p1"))).toContain(
      "1 to 8",
    );
  });

  test("neither --workers nor --worker, or both, is refused", () => {
    expect(refusal(() => newTeamPayload(base, "p1"))).toContain("--workers or --worker");
    expect(
      refusal(() => newTeamPayload({ ...base, workers: 2, workerSpecs: ["", ""] }, "p1")),
    ).toContain("not both");
  });
});

describe("team new (issue #3455)", () => {
  const args: TeamCliArgs = { action: "new", goal: "Fix the login", workers: 2 };

  test("creates the team on the only project and says which workers wait in the run queue", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await run(args, daemon);
    expect(result.code).toBe(0);
    expect(result.err).toEqual([]);
    expect(result.out).toEqual([
      "created t9  Fix the login  active  2 workers",
      "w2  waits in the run queue (card c2)",
    ]);
    expect(sentCreate(daemon)).toEqual({ projectId: "p1", goal: "Fix the login", workers: 2 });
  });

  test("a team whose workers all started says nothing about a queue", async () => {
    const running = created({
      members: [
        member("lead", "coordinator", { sessionId: "s1" }),
        member("w1", "worker", { cardId: "c1", sessionId: "s2" }),
      ],
    });
    const result = await run(args, fakeDaemon({ ...HANDLERS, "teams.create": () => running }));
    expect(result.out).toEqual(["created t9  Fix the login  active  1 worker"]);
  });

  test("--project, by name or by id, picks the project", async () => {
    for (const wanted of ["web", "p2"]) {
      const daemon = fakeDaemon({ ...HANDLERS, "project.list": () => TWO_PROJECTS });
      const result = await run({ ...args, project: wanted }, daemon);
      expect(result.code).toBe(0);
      expect(sentCreate(daemon)).toMatchObject({ projectId: "p2" });
    }
  });

  test("with several projects and none named, nothing is created and the projects are listed", async () => {
    const daemon = fakeDaemon({ ...HANDLERS, "project.list": () => TWO_PROJECTS });
    const result = await run(args, daemon);
    expect(result.code).toBe(1);
    expect(text(result)).toContain("api, web");
    expect(sentCreate(daemon)).toBeUndefined();
  });

  test("a bad member spec is refused before anything is created", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await run(
      { ...args, workers: undefined, workerSpecs: ["dev:opus:ultra"] },
      daemon,
    );
    expect(result.code).toBe(1);
    expect(text(result)).toContain("effort");
    expect(sentCreate(daemon)).toBeUndefined();
  });

  test("a member on bypassPermissions needs --confirm, as the app asks the person again", async () => {
    for (const bypassing of [
      { coordinator: ":::bypassPermissions" },
      { workers: undefined, workerSpecs: ["", "developer:::bypassPermissions"] },
    ]) {
      const refused = fakeDaemon(HANDLERS);
      const no = await run({ ...args, ...bypassing }, refused);
      expect(no.code).toBe(1);
      expect(text(no)).toContain("--confirm");
      expect(sentCreate(refused)).toBeUndefined();

      const allowed = fakeDaemon(HANDLERS);
      const yes = await run({ ...args, ...bypassing, confirm: true }, allowed);
      expect(yes.code).toBe(0);
      expect(sentCreate(allowed)).toBeDefined();
    }
  });

  test("--confirm without a member on bypass is not needed and changes nothing", async () => {
    const plain = fakeDaemon(HANDLERS);
    const confirmed = fakeDaemon(HANDLERS);
    await run(args, plain);
    await run({ ...args, confirm: true }, confirmed);
    expect(sentCreate(plain)).toEqual({ projectId: "p1", goal: "Fix the login", workers: 2 });
    expect(sentCreate(confirmed)).toEqual(sentCreate(plain));
  });

  test("--json prints the team the daemon returned", async () => {
    const result = await run({ ...args, json: true }, fakeDaemon(HANDLERS));
    expect(JSON.parse(result.out.join("\n"))).toEqual(created());
  });

  test("a daemon that refuses (over quota) is exit 1 with its reason and no team", async () => {
    const daemon = fakeDaemon({
      ...HANDLERS,
      "teams.create": () => ({
        error: { code: "quota_blocked", message: "the plan quota is spent: create the team later" },
      }),
    });
    const result = await run(args, daemon);
    expect(result.code).toBe(1);
    expect(result.out).toEqual([]);
    expect(text(result)).toContain("the plan quota is spent");
  });

  test("a create that got no answer says its result is unknown, so nobody retries blindly", async () => {
    const silent = fakeDaemon({ "project.list": () => ONE_PROJECT });
    const result = await run(args, silent, 200);
    expect(result.code).toBe(2);
    expect(text(result)).toContain("may or may not have been created");
    expect(text(result)).toContain("team list");
  });

  test("the token of the config is in none of the output", async () => {
    const daemon = fakeDaemon({
      ...HANDLERS,
      "teams.create": () => ({ error: { code: "x", message: TOKEN } }),
    });
    const result = await run(args, daemon);
    expect(result.code).toBe(1);
    expect(text(result)).not.toContain(TOKEN);
  });
});

describe("flightdeckd team new, as the terminal runs it (issue #3455)", () => {
  async function terminal(argv: string[]) {
    const daemon = fakeDaemon(HANDLERS);
    try {
      return { ...(await flightdeckd(argv, daemon.port)), daemon };
    } catch (error) {
      return { out: [], err: [String(error)], code: -1, daemon };
    }
  }

  test("creates the team and exits 0", async () => {
    const result = await terminal(["team", "new", "Fix the login", "--workers", "2"]);
    expect({ code: result.code, first: result.out[0] }).toEqual({
      code: 0,
      first: "created t9  Fix the login  active  2 workers",
    });
    expect(sentCreate(result.daemon)).toEqual({
      projectId: "p1",
      goal: "Fix the login",
      workers: 2,
    });
  });

  test("a team with no worker count is exit 1 with the usage and nothing sent", async () => {
    const result = await terminal(["team", "new", "Fix the login"]);
    expect(result.code).toBe(1);
    expect(text(result)).toContain("--workers or --worker");
    expect(sentCreate(result.daemon)).toBeUndefined();
  });
});

describe("team new: the arguments (issue #3455)", () => {
  test("every flag, with what it fills", () => {
    expect(
      parsed([
        "team",
        "new",
        "Fix the login",
        "--workers",
        "2",
        "--name",
        "Login",
        "--check",
        "bun test",
        "--check",
        "bun run lint",
        "--coordinator",
        "architect:opus",
        "--project",
        "web",
        "--confirm",
        "--json",
      ]),
    ).toMatchObject({
      command: "team",
      action: "new",
      teamGoal: "Fix the login",
      teamWorkers: 2,
      personaName: "Login",
      teamChecks: ["bun test", "bun run lint"],
      teamCoordinator: "architect:opus",
      project: "web",
      confirm: true,
      json: true,
    });
  });

  test("--worker repeats, one worker each", () => {
    expect(
      parsed(["team", "new", "g", "--worker", "developer:opus", "--worker", "reviewer"]),
    ).toMatchObject({ teamWorkerSpecs: ["developer:opus", "reviewer"] });
  });

  test("the goal is needed, and is not blank", () => {
    expect(parsed(["team", "new", "--workers", "1"])).toMatchObject({
      error: expect.stringContaining("the goal"),
    });
    expect(parsed(["team", "new", "   ", "--workers", "1"])).toMatchObject({
      error: expect.stringContaining("the goal"),
    });
  });

  test("the worker count is 1 to 8 and one way only", () => {
    for (const ok of ["1", "8"])
      expect(parsed(["team", "new", "g", "--workers", ok])).toMatchObject({
        teamWorkers: Number(ok),
      });
    for (const bad of ["0", "9", "1.5", "two", ""])
      expect(parsed(["team", "new", "g", "--workers", bad])).toMatchObject({
        error: expect.stringContaining("--workers"),
      });
    expect(parsed(["team", "new", "g"])).toMatchObject({
      error: expect.stringContaining("--workers or --worker"),
    });
    expect(parsed(["team", "new", "g", "--workers", "2", "--worker", "x"])).toMatchObject({
      error: expect.stringContaining("not both"),
    });
    const eight = Array.from({ length: 8 }, () => ["--worker", "developer"]).flat();
    expect(parsed(["team", "new", "g", ...eight])).toMatchObject({ action: "new" });
    expect(parsed(["team", "new", "g", ...eight, "--worker", "developer"])).toMatchObject({
      error: expect.stringContaining("1 to 8"),
    });
  });

  test("a bad member spec is refused with the usage", () => {
    expect(parsed(["team", "new", "g", "--worker", "dev:opus:ultra"])).toMatchObject({
      error: expect.stringContaining("effort"),
    });
    expect(
      parsed(["team", "new", "g", "--workers", "1", "--coordinator", "a:b:c:d:e"]),
    ).toMatchObject({
      error: expect.stringContaining("at most 4 parts"),
    });
  });

  test("these flags belong to team new only", () => {
    for (const flags of [
      ["--workers", "2"],
      ["--worker", "x"],
      ["--coordinator", "x"],
      ["--check", "bun test"],
      ["--name", "Login"],
      ["--confirm"],
    ]) {
      for (const verb of [
        ["team", "list"],
        ["team", "show", "t1"],
      ]) {
        expect(parsed([...verb, ...flags])).toMatchObject({
          error: expect.stringContaining("this flag only applies to flightdeckd team new"),
        });
      }
    }
    expect(parsed(["card", "list", "--workers", "2"])).toMatchObject({
      error: expect.stringContaining("--workers"),
    });
  });
});
