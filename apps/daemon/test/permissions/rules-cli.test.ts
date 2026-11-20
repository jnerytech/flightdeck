import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { fakeDaemon, HOST, project, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const hasControl = (text: string) => [...text].some((c) => c.charCodeAt(0) < 32);

const ONE_PROJECT = {
  "project.list": () => ({ projects: [project("p1", "api")], maxParallelRuns: 2 }),
};

const RULES = ["Bash(bun test:*)", "Edit(src/**)"];

const decision = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  projectId: "p1",
  sessionKey: "s1",
  requestId: `r-${id}`,
  toolName: "Bash",
  risk: "low",
  decision: "allow",
  reason: "a test run",
  by: "rule",
  model: null,
  at: "2026-11-20T09:00:00.000Z",
  ...over,
});

const SUSPENDED = {
  sessionKey: "s7",
  reason: "third-party content",
  at: "2026-11-20T08:00:00.000Z",
};

describe("flightdeckd rules list (issue #3457)", () => {
  test("--json prints the rule strings of the project, by name or id, and exits 0", async () => {
    for (const ref of ["API", "p1"]) {
      const daemon = fakeDaemon({ ...HOST, "rules.list": () => ({ rules: RULES }) });
      const run = await flightdeckd(["rules", "list", "--project", ref, "--json"], daemon.port);
      expect(run.code).toBe(0);
      expect(run.err).toEqual([]);
      expect(JSON.parse(run.out.join("\n"))).toEqual(RULES);
      expect(daemon.calls.find((c) => c.type === "rules.list")?.payload).toEqual({
        projectId: "p1",
      });
    }
  });

  test("without --project a host with one project uses it", async () => {
    const daemon = fakeDaemon({ ...ONE_PROJECT, "rules.list": () => ({ rules: RULES }) });
    const run = await flightdeckd(["rules", "list"], daemon.port);
    expect(run.code).toBe(0);
    expect(run.out).toEqual(RULES);
  });

  test("a host with several projects and no --project is refused with their names, and nothing is read", async () => {
    const daemon = fakeDaemon({ ...HOST, "rules.list": () => ({ rules: RULES }) });
    const run = await flightdeckd(["rules", "list"], daemon.port);
    expect(run.code).toBe(1);
    expect(run.out).toEqual([]);
    expect(run.err.join("\n")).toContain("api");
    expect(run.err.join("\n")).toContain("web");
    expect(daemon.calls.some((c) => c.type === "rules.list")).toBe(false);
  });

  test("a project nobody has is refused with exit 1 and a line that names it", async () => {
    const daemon = fakeDaemon({ ...HOST, "rules.list": () => ({ rules: RULES }) });
    const run = await flightdeckd(["rules", "list", "--project", "ghost"], daemon.port);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("ghost");
    expect(daemon.calls.some((c) => c.type === "rules.list")).toBe(false);
  });

  test("a project with no rules gives an empty array with --json and a line without it", async () => {
    const daemon = fakeDaemon({ ...ONE_PROJECT, "rules.list": () => ({ rules: [] }) });
    const machine = await flightdeckd(["rules", "list", "--json"], daemon.port);
    expect(machine.code).toBe(0);
    expect(JSON.parse(machine.out.join("\n"))).toEqual([]);
    const human = await flightdeckd(["rules", "list"], daemon.port);
    expect(human.code).toBe(0);
    expect(human.out).toEqual(["no permission rules in api"]);
  });

  test("a rule cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      ...ONE_PROJECT,
      "rules.list": () => ({ rules: ["Bash(echo \u001b[2J:*)"] }),
    });
    const human = await flightdeckd(["rules", "list"], daemon.port);
    expect(human.out).toHaveLength(1);
    expect(human.out.some(hasControl)).toBe(false);
  });

  test("the daemon's refusal is exit 1 with its reason; no daemon is exit 2", async () => {
    const refusing = fakeDaemon({
      ...ONE_PROJECT,
      "rules.list": () => ({ error: { code: "not_found", message: "the project has no folder" } }),
    });
    const refused = await flightdeckd(["rules", "list"], refusing.port);
    expect(refused.code).toBe(1);
    expect(refused.err.join("\n")).toContain("the project has no folder");
    const gone = fakeDaemon({});
    const port = gone.port;
    await stopAll();
    const none = await flightdeckd(["rules", "list"], port);
    expect(none.code).toBe(2);
    expect(none.err.join("\n")).toContain("could not reach the daemon");
  });

  test("a flag of another command is refused before anything is sent", async () => {
    const daemon = fakeDaemon({ ...ONE_PROJECT, "rules.list": () => ({ rules: RULES }) });
    for (const flags of [["--limit", "5"], ["--session", "s1"], ["--confirm"]]) {
      const run = await flightdeckd(["rules", "list", ...flags], daemon.port);
      expect(run.code).toBe(1);
      expect(run.err.join("\n")).toContain("this flag only applies");
    }
    expect(daemon.calls).toEqual([]);
  });
});

describe("flightdeckd autoapprove list (issue #3457)", () => {
  const LIST = {
    ...HOST,
    "autoapprove.list": () => ({
      decisions: [
        decision("d2", { decision: "ask", risk: "high", reason: "touches the vault", by: "ai" }),
        decision("d1"),
      ],
      suspended: [SUSPENDED],
    }),
  };

  test("--json prints what the daemon answered, the decisions newest first and the suspended sessions", async () => {
    const daemon = fakeDaemon(LIST);
    const run = await flightdeckd(["autoapprove", "list", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(run.err).toEqual([]);
    const answer = JSON.parse(run.out.join("\n")) as {
      decisions: Array<{ id: string }>;
      suspended: unknown[];
    };
    expect(answer.decisions.map((d) => d.id)).toEqual(["d2", "d1"]);
    expect(answer.suspended).toEqual([SUSPENDED]);
    expect(daemon.calls.find((c) => c.type === "autoapprove.list")?.payload).toEqual({});
  });

  test("--project, --session and --limit narrow the request; the project is named by its name or id", async () => {
    const daemon = fakeDaemon(LIST);
    const run = await flightdeckd(
      ["autoapprove", "list", "--project", "web", "--session", "s1", "--limit", "5", "--json"],
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(daemon.calls.find((c) => c.type === "autoapprove.list")?.payload).toEqual({
      projectId: "p2",
      sessionKey: "s1",
      limit: 5,
    });
  });

  test("without --json the suspended sessions come first, then one line per decision", async () => {
    const run = await flightdeckd(["autoapprove", "list"], fakeDaemon(LIST).port);
    expect(run.code).toBe(0);
    expect(run.out).toEqual([
      "suspended  s7  third-party content  2026-11-20T08:00:00.000Z",
      "2026-11-20T09:00:00.000Z  ask  high  Bash  s1  ai  touches the vault",
      "2026-11-20T09:00:00.000Z  allow  low  Bash  s1  rule  a test run",
    ]);
  });

  test("--session keeps only that session's suspension, in the line and in the JSON", async () => {
    const other = { ...SUSPENDED, sessionKey: "s9" };
    const daemon = fakeDaemon({
      "autoapprove.list": () => ({ decisions: [], suspended: [SUSPENDED, other] }),
    });
    const machine = await flightdeckd(
      ["autoapprove", "list", "--session", "s9", "--json"],
      daemon.port,
    );
    expect(JSON.parse(machine.out.join("\n")).suspended).toEqual([other]);
    const human = await flightdeckd(["autoapprove", "list", "--session", "s9"], daemon.port);
    expect(human.out.join("\n")).toContain("suspended  s9");
    expect(human.out.join("\n")).not.toContain("s7");
  });

  test("nothing decided and nothing suspended says so, and --json gives empty arrays", async () => {
    const daemon = fakeDaemon({ "autoapprove.list": () => ({ decisions: [], suspended: [] }) });
    const human = await flightdeckd(["autoapprove", "list"], daemon.port);
    expect(human.code).toBe(0);
    expect(human.out).toEqual(["no automatic approval decisions yet"]);
    const machine = await flightdeckd(["autoapprove", "list", "--json"], daemon.port);
    expect(JSON.parse(machine.out.join("\n"))).toEqual({ decisions: [], suspended: [] });
  });

  test("--limit outside 1 to 1000 or not a number is refused before anything is sent", async () => {
    const daemon = fakeDaemon(LIST);
    for (const bad of ["0", "1001", "x", "2.5"]) {
      const run = await flightdeckd(["autoapprove", "list", "--limit", bad], daemon.port);
      expect(run.code).toBe(1);
      expect(run.err.join("\n")).toContain("--limit");
    }
    expect(daemon.calls).toEqual([]);
  });

  test("a project nobody has is refused with exit 1", async () => {
    const daemon = fakeDaemon(LIST);
    const run = await flightdeckd(["autoapprove", "list", "--project", "ghost"], daemon.port);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("ghost");
    expect(daemon.calls.some((c) => c.type === "autoapprove.list")).toBe(false);
  });

  test("a reason cannot drive the terminal, and a secret in it is redacted in the line and in the JSON", async () => {
    const token = `ghp_${"a1B2c3D4e5".repeat(4)}`;
    const daemon = fakeDaemon({
      "autoapprove.list": () => ({
        decisions: [decision("d1", { reason: `curl with ${token}\u001b[2J` })],
        suspended: [{ ...SUSPENDED, reason: "bad\u001b]0;pwn\u0007" }],
      }),
    });
    const human = await flightdeckd(["autoapprove", "list"], daemon.port);
    expect(human.out.some(hasControl)).toBe(false);
    expect(human.out.join("\n")).not.toContain(token);
    const machine = await flightdeckd(["autoapprove", "list", "--json"], daemon.port);
    expect(machine.out.join("\n")).not.toContain(token);
    expect(machine.out.join("").length).toBeGreaterThan(2);
  });

  test("no daemon is exit 2 with a line that says so", async () => {
    const gone = fakeDaemon({});
    const port = gone.port;
    await stopAll();
    const run = await flightdeckd(["autoapprove", "list"], port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("could not reach the daemon");
  });
});
