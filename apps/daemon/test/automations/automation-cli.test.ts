import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { CLOSE, fakeDaemon, type Handlers, project, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const NIGHTLY = {
  id: "a1",
  projectId: "p1",
  name: "Nightly triage",
  enabled: true,
  trigger: { type: "cron", expr: "0 3 * * *", tz: "Europe/Lisbon" },
  action: { type: "start_workflow", workflow: "triage", inputs: { depth: "2" } },
  maxRunsPerDay: 5,
  allowExternalAuthors: false,
  createdAt: "2026-11-01T09:00:00.000Z",
};

const FIX_CI = {
  id: "a2",
  projectId: "p1",
  name: "Fix failing checks",
  enabled: false,
  trigger: { type: "ci_failed" },
  action: { type: "create_card" },
  maxRunsPerDay: 3,
  allowExternalAuthors: true,
  createdAt: "2026-11-02T09:00:00.000Z",
};

const LABELED = {
  ...FIX_CI,
  id: "a3",
  name: "Bugs",
  trigger: { type: "issue_label", label: "bug" },
  action: { type: "send_to_card" },
};

const COMMENT = { ...FIX_CI, id: "a4", name: "Review", trigger: { type: "pr_comment" } };

const RUNS = [
  {
    id: "r1",
    automationId: "a1",
    firedAt: "2026-11-20T03:00:00.000Z",
    cause: "cron 0 3 * * *",
    status: "ok",
    detail: null,
  },
  {
    id: "r2",
    automationId: "a1",
    firedAt: "2026-11-19T03:00:00.000Z",
    cause: "cron 0 3 * * *",
    status: "failed",
    detail: "workflow triage not found",
  },
];

const OPEN: Handlers = {
  "project.list": () => ({
    projects: [project("p1", "api"), project("p2", "web"), project("p3", "web")],
    maxParallelRuns: 2,
  }),
  "automation.list": () => ({ automations: [NIGHTLY, FIX_CI] }),
  "automation.runs": () => ({ runs: RUNS }),
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

describe("flightdeckd automation list (issue #3627)", () => {
  test("a project's automations: one line each, with its state, trigger, action and daily limit", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "automation.list": () => ({ automations: [NIGHTLY, FIX_CI, LABELED, COMMENT] }),
    });
    const run = await flightdeckd(["automation", "list", "api"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "a1: Nightly triage, on, cron 0 3 * * * (Europe/Lisbon), start workflow triage, up to 5 runs a day",
        "a2: Fix failing checks, off, checks fail, create card, up to 3 runs a day, external authors allowed",
        "a3: Bugs, off, issue labeled bug, send to card, up to 3 runs a day, external authors allowed",
        "a4: Review, off, PR comment, create card, up to 3 runs a day, external authors allowed",
      ],
      err: [],
    });
    expect(callsOf(daemon, "automation.list")).toEqual([{ projectId: "p1" }]);
  });

  test("a project with no automation says so and exits 0", async () => {
    const daemon = fakeDaemon({ ...OPEN, "automation.list": () => ({ automations: [] }) });
    const run = await flightdeckd(["automation", "list", "p1"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 0, out: ["api: no automations"] });
  });

  test("--json prints every key, null where an action leaves a field out", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["automation", "list", "api", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual({
      automations: [
        {
          ...NIGHTLY,
          action: {
            type: "start_workflow",
            workflow: "triage",
            inputs: { depth: "2" },
            title: null,
            description: null,
          },
        },
        FIX_CI,
      ],
    });
  });

  test("a project name two projects share is refused with exit 1 and asks nothing of the automations", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["automation", "list", "web"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("the name of several projects");
    expect(callsOf(daemon, "automation.list")).toEqual([]);
  });

  test("a closed connection is exit 2, and text from the daemon cannot drive the terminal", async () => {
    const gone = fakeDaemon({ ...OPEN, "automation.list": () => CLOSE });
    const hostile = fakeDaemon({
      ...OPEN,
      "automation.list": () => ({ automations: [{ ...NIGHTLY, name: "\u001b[2Jwiped" }] }),
    });
    expect((await flightdeckd(["automation", "list", "api"], gone.port)).code).toBe(2);
    const run = await flightdeckd(["automation", "list", "api"], hostile.port);
    expect(run.out.join("\n")).toContain("wiped");
    expect(run.out.join("\n").includes("\u001b")).toBe(false);
  });
});

describe("flightdeckd automation runs (issue #3627)", () => {
  test("an automation's runs: the time, the status, the cause and the detail", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["automation", "runs", "a1"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "a1: 2 runs",
        "  2026-11-20T03:00:00.000Z ok, cron 0 3 * * *",
        "  2026-11-19T03:00:00.000Z failed, cron 0 3 * * *: workflow triage not found",
      ],
      err: [],
    });
    expect(callsOf(daemon, "automation.runs")).toEqual([{ id: "a1" }]);
  });

  test("--limit goes to the daemon, and an automation that never fired says so", async () => {
    const daemon = fakeDaemon({ ...OPEN, "automation.runs": () => ({ runs: [] }) });
    const run = await flightdeckd(["automation", "runs", "a1", "--limit", "20"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 0, out: ["a1: no runs"] });
    expect(callsOf(daemon, "automation.runs")).toEqual([{ id: "a1", limit: 20 }]);
  });

  test("--json prints the runs with every key", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["automation", "runs", "a1", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual({ runs: RUNS });
  });

  test("a limit outside 1 to 500 is refused before the daemon is asked; 500 is allowed", async () => {
    const daemon = fakeDaemon(OPEN);
    const zero = await flightdeckd(["automation", "runs", "a1", "--limit", "0"], daemon.port);
    const most = await flightdeckd(["automation", "runs", "a1", "--limit", "501"], daemon.port);
    const edge = await flightdeckd(["automation", "runs", "a1", "--limit", "500"], daemon.port);
    expect([zero.code, most.code, edge.code]).toEqual([1, 1, 0]);
    expect(callsOf(daemon, "automation.runs")).toEqual([{ id: "a1", limit: 500 }]);
  });

  test("a refusal from the daemon is one line on stderr and exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "automation.runs": () => ({
        error: { code: "invalid_state", message: "automations are off on this host" },
      }),
    });
    const run = await flightdeckd(["automation", "runs", "nope"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("automations are off on this host");
  });
});

describe("flightdeckd automation words (issue #3627)", () => {
  test("a missing operand, an unknown verb and a stray flag are refused with exit 1", async () => {
    const daemon = fakeDaemon(OPEN);
    const bare = await flightdeckd(["automation", "list"], daemon.port);
    const unknown = await flightdeckd(["automation", "bogus", "api"], daemon.port);
    const stray = await flightdeckd(["automation", "list", "api", "--limit", "5"], daemon.port);
    expect([bare.code, unknown.code, stray.code]).toEqual([1, 1, 1]);
    expect(daemon.calls).toEqual([]);
  });
});
