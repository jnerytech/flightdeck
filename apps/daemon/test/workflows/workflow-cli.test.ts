import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type {
  RunResumeCheck,
  WorkflowInfo,
  WorkflowRun,
  WorkflowTemplate,
} from "@flightdeck/protocol";
import { parseArgs } from "../../src/main.ts";
import { runWorkflowCli } from "../../src/workflows/index.ts";
import { fakeDaemon, type Handlers, project, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";
import { watchedCli } from "../support/cli-watch.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const SHIP_HASH = "a1".repeat(32);
const SHIP: WorkflowInfo = {
  name: "ship",
  hash: SHIP_HASH,
  trusted: true,
  checks: ["bun test", "bun run lint"],
  errors: [],
  inputs: ["ticket"],
};
const DOCS: WorkflowInfo = {
  ...SHIP,
  name: "docs",
  hash: "b2".repeat(32),
  trusted: false,
  checks: [],
  inputs: [],
};
const BROKEN: WorkflowInfo = {
  ...DOCS,
  name: "broken",
  hash: "c3".repeat(32),
  errors: ["step build: unknown type"],
};

const TEMPLATE: WorkflowTemplate = {
  id: "review-loop",
  title: { en: "Review loop", "pt-BR": "Ciclo de revisão" },
  description: { en: "d", "pt-BR": "d" },
  limits: { en: "l", "pt-BR": "l" },
  persona: "reviewer",
  inputs: ["ticket"],
  path: ".flightdeck/workflows/review-loop.yaml",
  yaml: "name: review-loop\n",
  checkFilled: true,
};

const RUN: WorkflowRun = {
  id: "r1",
  cardId: "c1",
  workflowName: "ship",
  workflowHash: SHIP_HASH,
  status: "failed",
  statusReason: "check failed",
  budget: { maxCostUsd: 5 },
  usage: { turns: 3, minutes: 4.5, costUsd: 1.25 },
  inputs: { ticket: "T-1" },
  startedAt: "2026-11-21T09:00:00Z",
  endedAt: "2026-11-21T09:05:00Z",
  quotaUntil: null,
  steps: [
    {
      stepId: "build",
      attempt: 1,
      type: "check",
      status: "failed",
      sessionId: null,
      output: "boom",
      exitCode: 1,
      note: null,
      message: null,
      usage: null,
      startedAt: "2026-11-21T09:01:00Z",
      endedAt: "2026-11-21T09:02:00Z",
    },
  ],
};

const base = (over: Handlers = {}): Handlers => ({
  "project.list": () => ({ projects: [project("p1", "api")], maxParallelRuns: 2 }),
  "workflow.list": () => ({ workflows: [SHIP, DOCS, BROKEN] }),
  "workflow.templates": () => ({ templates: [TEMPLATE] }),
  "workflow.validate": () => BROKEN,
  "run.get": () => RUN,
  "run.resume": (): RunResumeCheck => ({ from: "build", ok: true }),
  "run.watch": () => ({}),
  ...over,
});

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

const printed = (out: string[]): unknown => {
  try {
    return JSON.parse(out.join("\n"));
  } catch {
    return out;
  }
};

describe("flightdeckd workflow list, templates and validate (issue #3628)", () => {
  test("list prints each workflow with its full hash, its trust, its checks and its errors", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["workflow", "list", "api"], daemon.port);
    expect(run.out).toEqual([
      `ship  ${SHIP_HASH}  trusted  checks: 2  inputs: ticket`,
      `docs  ${"b2".repeat(32)}  untrusted  checks: 0  inputs: none`,
      `broken  ${"c3".repeat(32)}  invalid  checks: 0  inputs: none`,
      "  error: step build: unknown type",
    ]);
    expect(run.code).toBe(0);
    expect(callsOf(daemon, "workflow.list")).toEqual([{ projectId: "p1" }]);
  });

  test("list --json prints what the daemon answered", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["workflow", "list", "api", "--json"], daemon.port);
    expect(printed(run.out)).toEqual({ workflows: [SHIP, DOCS, BROKEN] });
  });

  test("a host with no workflow says so", async () => {
    const daemon = fakeDaemon(base({ "workflow.list": () => ({ workflows: [] }) }));
    const run = await flightdeckd(["workflow", "list", "api"], daemon.port);
    expect(run.out).toEqual(["no workflow in .flightdeck/workflows on the base branch"]);
  });

  test("an unknown project is refused with exit 1 before the daemon is asked", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["workflow", "list", "nope"], daemon.port);
    expect(run.code).toBe(1);
    expect(callsOf(daemon, "workflow.list")).toEqual([]);
  });

  test("templates prints the id, the title, where it goes, its persona and its check line", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["workflow", "templates", "api"], daemon.port);
    expect(run.out).toEqual([
      "review-loop  Review loop  .flightdeck/workflows/review-loop.yaml  persona: reviewer  check: filled",
    ]);
    expect(callsOf(daemon, "workflow.templates")).toEqual([{ projectId: "p1" }]);
  });

  test("validate prints the workflow with its inputs, checks and errors, and exits 0 even when it is invalid", async () => {
    const daemon = fakeDaemon(
      base({
        "workflow.validate": () => ({ ...BROKEN, checks: ["bun test"], inputs: ["ticket"] }),
      }),
    );
    const run = await flightdeckd(["workflow", "validate", "api", "broken"], daemon.port);
    expect(run.out).toEqual([
      `broken  ${"c3".repeat(32)}  invalid`,
      "  input: ticket",
      "  check: bun test",
      "  error: step build: unknown type",
    ]);
    expect(run.code).toBe(0);
    expect(callsOf(daemon, "workflow.validate")).toEqual([{ projectId: "p1", name: "broken" }]);
  });

  test("a workflow the daemon does not know is its refusal, exit 1", async () => {
    const daemon = fakeDaemon(
      base({
        "workflow.validate": () => ({ error: { code: "not_found", message: "no workflow nope" } }),
      }),
    );
    const run = await flightdeckd(["workflow", "validate", "api", "nope"], daemon.port);
    expect(run.code).toBe(1);
  });

  test("no daemon is exit 2", async () => {
    const daemon = fakeDaemon(base());
    const { port } = daemon;
    await stopAll();
    const run = await flightdeckd(["workflow", "list", "api"], port);
    expect(run.code).toBe(2);
  });
});

describe("flightdeckd workflow run, watch and resume (issue #3628)", () => {
  test("run prints the run, what it spent and each step", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["workflow", "run", "r1"], daemon.port);
    expect(run.out).toEqual([
      "r1  ship  failed  card c1",
      "  reason: check failed",
      "  spent: 3 turns, 4.5 min, $1.25",
      "  build #1  check  failed  exit 1",
    ]);
    expect(callsOf(daemon, "run.get")).toEqual([{ runId: "r1" }]);
  });

  test("run --json prints the run as the daemon answered", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["workflow", "run", "r1", "--json"], daemon.port);
    expect(printed(run.out)).toEqual(RUN);
  });

  test("an unknown run is the daemon's refusal, exit 1", async () => {
    const daemon = fakeDaemon(
      base({ "run.get": () => ({ error: { code: "not_found", message: "no run r9" } }) }),
    );
    const run = await flightdeckd(["workflow", "run", "r9"], daemon.port);
    expect(run.code).toBe(1);
  });

  test("resume only checks: it says where the run would resume and sends no confirm", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["workflow", "resume", "r1"], daemon.port);
    expect(run.out).toEqual(["r1 can resume from build"]);
    expect(run.code).toBe(0);
    expect(callsOf(daemon, "run.resume")).toEqual([{ runId: "r1" }]);
  });

  test("resume says why a run cannot resume with its parameters, exits 1, and --json prints the check", async () => {
    const check: RunResumeCheck = {
      from: "",
      ok: false,
      reason: "run_resume_branch_moved",
      params: { branch: "card/c1" },
    };
    const daemon = fakeDaemon(base({ "run.resume": () => check }));
    const text = await flightdeckd(["workflow", "resume", "r1"], daemon.port);
    expect(text.out).toEqual(["r1 cannot resume: run_resume_branch_moved (branch: card/c1)"]);
    expect(text.code).toBe(1);
    const asJson = await flightdeckd(["workflow", "resume", "r1", "--json"], daemon.port);
    expect(printed(asJson.out)).toEqual(check);
    expect(asJson.code).toBe(1);
  });

  test("watch writes a line for each change of a run and Ctrl-C ends it with 0", async () => {
    const daemon = fakeDaemon(base());
    const { result, lines } = await watchedCli(
      daemon,
      "run.watch",
      (cfg, options) => runWorkflowCli({ action: "watch" }, cfg, options),
      {
        lines: 2,
        after: () => {
          daemon.push({
            type: "run.updated",
            run: { ...RUN, status: "running", statusReason: null, steps: [] },
          });
          daemon.push({ type: "run.updated", run: RUN });
        },
      },
    );
    expect(lines).toEqual([
      "r1  ship  running  no step yet",
      "r1  ship  failed  build failed  check failed",
    ]);
    expect(result.code).toBe(0);
  });

  test("watch --json writes each run on one line", async () => {
    const daemon = fakeDaemon(base());
    const { lines } = await watchedCli(
      daemon,
      "run.watch",
      (cfg, options) => runWorkflowCli({ action: "watch", json: true }, cfg, options),
      { after: () => daemon.push({ type: "run.updated", run: RUN }) },
    );
    expect(lines.map((line) => JSON.parse(line))).toEqual([RUN]);
  });
});

describe("the workflow arguments (issue #3628)", () => {
  test("each verb takes its operands, and a missing one is named", () => {
    expect(parseArgs(["workflow", "list", "api"])).toMatchObject({
      command: "workflow",
      action: "list",
      workflowWords: ["api"],
    });
    expect(parseArgs(["workflow", "validate", "api", "ship"])).toMatchObject({
      action: "validate",
      workflowWords: ["api", "ship"],
    });
    expect(parseArgs(["workflow", "run", "r1"])).toMatchObject({
      action: "run",
      workflowWords: ["r1"],
    });
    expect(parseArgs(["workflow", "watch"])).toMatchObject({ action: "watch" });
    expect(() => parseArgs(["workflow", "list"])).toThrow("missing the project");
    expect(() => parseArgs(["workflow", "validate", "api"])).toThrow("missing the workflow");
    expect(() => parseArgs(["workflow", "resume"])).toThrow("missing the run");
    expect(() => parseArgs(["workflow", "frobnicate"])).toThrow("invalid workflow action");
  });

  test("--json and --host are read, and --confirm is refused until a verb takes it", () => {
    expect(parseArgs(["workflow", "list", "api", "--json", "--host", "pi"])).toMatchObject({
      json: true,
      host: "pi",
    });
    expect(() => parseArgs(["workflow", "resume", "r1", "--confirm"])).toThrow("--confirm");
  });
});
