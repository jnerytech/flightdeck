import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, project, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

/** An action as `actions.list` answers it: the whole declaration, which a CLI must not print. */
const action = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  description: `${name} does its job`,
  source: "versioned",
  projectId: "p1",
  host: null,
  ssh: null,
  run: ["deploy.sh", "--token", "{{secret.token}}"],
  cwd: "/srv/app",
  env: { TOKEN: "{{secret.token}}" },
  params: { branch: { pattern: "^[a-z]+$", default: "main" } },
  timeoutS: 60,
  approval: "always",
  tags: ["prod"],
  secrets: { values: ["token"], files: [] },
  trusted: true,
  changed: [],
  hash: `hash-${name}`,
  ...extra,
});

const TRUSTED = action("deploy");
const UNTRUSTED = action("build", {
  trusted: false,
  changed: ["declaração", ".flightdeck/build.sh"],
  approval: "first-per-session",
});

const RUNS = [
  {
    id: "r1",
    name: "deploy",
    projectId: "p1",
    requestedBy: "claude",
    startedAt: "2026-11-20T03:00:00.000Z",
    durationMs: 1200,
    exitCode: 0,
    timedOut: false,
    truncated: false,
    output: "deployed\n",
  },
  {
    id: "r2",
    name: "deploy",
    projectId: "p1",
    requestedBy: "you",
    startedAt: "2026-11-19T03:00:00.000Z",
    durationMs: 60_000,
    exitCode: 124,
    timedOut: true,
    truncated: true,
    output: "***\nslow",
  },
];

const OPEN: Handlers = {
  "project.list": () => ({
    projects: [project("p1", "api"), project("p2", "web"), project("p3", "web")],
    maxParallelRuns: 2,
  }),
  "actions.list": () => ({ actions: [TRUSTED, UNTRUSTED], errors: [] }),
  "actions.runs": () => ({ runs: RUNS }),
};

const printed = (out: string[]) => {
  try {
    return JSON.parse(out.join("\n")) as unknown;
  } catch {
    return null;
  }
};

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

describe("flightdeckd action runs (issue #3629)", () => {
  test("the runs of a project: the time, who asked, how it ended and the masked output", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["action", "runs", "--project", "api"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "2 runs",
        "  2026-11-20T03:00:00.000Z deploy by claude, exit 0 in 1200 ms",
        "    deployed",
        "  2026-11-19T03:00:00.000Z deploy by you, exit 124 in 60000 ms, timed out, output cut",
        "    ***",
        "    slow",
      ],
      err: [],
    });
    expect(callsOf(daemon, "actions.runs")).toEqual([{ projectId: "p1" }]);
  });

  test("a name keeps only that action's runs, --limit goes to the daemon, no project asks for the host's", async () => {
    const daemon = fakeDaemon({ ...OPEN, "actions.runs": () => ({ runs: [] }) });
    const run = await flightdeckd(["action", "runs", "deploy", "--limit", "20"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 0, out: ["no runs"] });
    expect(callsOf(daemon, "actions.runs")).toEqual([{ name: "deploy", limit: 20 }]);
    expect(callsOf(daemon, "project.list")).toEqual([]);
  });

  test("--json prints the runs whole, and exit 0", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["action", "runs", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual({ runs: RUNS });
  });

  test("a limit outside 1 to 500 is refused before the daemon is asked; 500 is allowed", async () => {
    const daemon = fakeDaemon(OPEN);
    const zero = await flightdeckd(["action", "runs", "--limit", "0"], daemon.port);
    const most = await flightdeckd(["action", "runs", "--limit", "501"], daemon.port);
    const edge = await flightdeckd(["action", "runs", "--limit", "500"], daemon.port);
    expect([zero.code, most.code, edge.code]).toEqual([1, 1, 0]);
    expect(callsOf(daemon, "actions.runs")).toEqual([{ limit: 500 }]);
  });

  test("a project name two projects share is refused with exit 1 and asks nothing of the runs", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["action", "runs", "--project", "web"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("the name of several projects");
    expect(callsOf(daemon, "actions.runs")).toEqual([]);
  });

  test("a closed connection is exit 2, and the output of a run cannot drive the terminal", async () => {
    const gone = fakeDaemon({ ...OPEN, "actions.runs": () => CLOSE });
    const hostile = fakeDaemon({
      ...OPEN,
      "actions.runs": () => ({ runs: [{ ...RUNS[0], output: "\u001b[2Jwiped" }] }),
    });
    expect((await flightdeckd(["action", "runs"], gone.port)).code).toBe(2);
    const run = await flightdeckd(["action", "runs"], hostile.port);
    expect(run.out.join("\n")).toContain("wiped");
    expect(run.out.join("\n").includes("\u001b")).toBe(false);
  });
});

describe("flightdeckd action list --json and --plain (issue #3629)", () => {
  test("--json lists every action, untrusted ones too, with the hash to trust and nothing that runs", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["action", "list", "--json"], daemon.port);
    expect(run.code).toBe(0);
    const keys = ["name", "description", "approval", "params", "hash", "trusted", "changed"];
    expect(printed(run.out)).toEqual({
      actions: [TRUSTED, UNTRUSTED].map((a) =>
        Object.fromEntries(keys.map((key) => [key, (a as Record<string, unknown>)[key]])),
      ),
    });
    for (const secret of ["run", "env", "secrets", "cwd", "deploy.sh"])
      expect(run.out.join("\n")).not.toContain(`"${secret}"`);
    expect(run.out.join("\n")).not.toContain("deploy.sh");
  });

  test("--plain: one line each, with whether it is trusted, its hash and what changed", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["action", "list", "--plain"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "deploy: deploy does its job, trusted, approval always, hash hash-deploy",
        "build: build does its job, not trusted, approval first-per-session, hash hash-build, changed declaração and .flightdeck/build.sh",
      ],
      err: [],
    });
  });

  test("--project names the project by its name or id; no project asks for the host's actions", async () => {
    const daemon = fakeDaemon(OPEN);
    await flightdeckd(["action", "list", "--json", "--project", "api"], daemon.port);
    await flightdeckd(["action", "list", "--json"], daemon.port);
    expect(callsOf(daemon, "actions.list")).toEqual([{ projectId: "p1" }, {}]);
  });

  test("a list with no action says so", async () => {
    const daemon = fakeDaemon({ ...OPEN, "actions.list": () => ({ actions: [], errors: [] }) });
    const run = await flightdeckd(["action", "list", "--plain"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 0, out: ["no actions"] });
  });

  test("with no flag the list is today's raw JSON: only the trusted actions, name, description, approval, params", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["action", "list", "--project", "p1"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual({
      actions: [
        {
          name: "deploy",
          description: "deploy does its job",
          approval: "always",
          params: TRUSTED.params,
        },
      ],
    });
    expect(callsOf(daemon, "actions.list")).toEqual([{ projectId: "p1" }]);
  });
});

describe("the flags of flightdeckd action (issue #3629)", () => {
  test("--plain belongs to list alone and does not go with --json", () => {
    expect(parseArgs(["action", "list", "--plain"])).toMatchObject({ plain: true });
    expect(() => parseArgs(["action", "runs", "--plain"])).toThrow("--plain: this flag only");
    expect(() => parseArgs(["action", "run", "deploy", "--plain"])).toThrow("--plain: this flag");
    expect(() => parseArgs(["action", "list", "--plain", "--json"])).toThrow("--plain");
    expect(() => parseArgs(["snippet", "list", "--plain"])).toThrow("--plain: this flag only");
  });

  test("--json and --host belong to the verbs that use the CLI contract", () => {
    expect(parseArgs(["action", "runs", "--json", "--host", "pi"])).toMatchObject({
      action: "runs",
      json: true,
      host: "pi",
    });
    expect(() => parseArgs(["action", "run", "deploy", "--json"])).toThrow("--json: this flag");
    expect(() => parseArgs(["action", "run", "deploy", "--host", "pi"])).toThrow("--host: this");
    expect(() => parseArgs(["action", "list", "--host", "pi"])).toThrow("--host: this flag");
    expect(parseArgs(["action", "list", "--plain", "--host", "pi"])).toMatchObject({ host: "pi" });
  });

  test("--limit is for runs alone, and runs takes an optional action name", () => {
    expect(parseArgs(["action", "runs", "deploy", "--limit", "5"])).toMatchObject({
      action: "runs",
      actionName: "deploy",
      limit: 5,
    });
    expect(parseArgs(["action", "runs", "--limit", "5"])).toMatchObject({ action: "runs" });
    expect(() => parseArgs(["action", "list", "--limit", "5"])).toThrow("--limit: this flag only");
    expect(() => parseArgs(["action", "run", "deploy", "--limit", "5"])).toThrow("--limit");
  });
});
