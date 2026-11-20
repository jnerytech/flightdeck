import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { resolve } from "node:path";
import type { CliResult } from "../../src/daemon-client/index.ts";
import { parseArgs } from "../../src/main.ts";
import { runProjectCli } from "../../src/projects/index.ts";
import { config, fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const text = (r: CliResult) => [...r.out, ...r.err].join("\n");
/** The parsed arguments, or what the parser refused with: a wrong parse fails an assertion. */
function parsed(argv: string[]): unknown {
  try {
    return parseArgs(argv);
  } catch (error) {
    return { refusedWith: (error as Error).message };
  }
}
const calls = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type);

const project = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "api",
  path: "/srv/api",
  baseBranch: "main",
  prProvider: "none",
  setupScript: null,
  promptTemplate: "",
  worktreeInclude: false,
  autoApprove: { enabled: false, model: "claude-haiku-5-5", lowWithoutAi: true },
  issues: null,
  personaByColumn: {},
  contractByColumn: {},
  personaSubagents: "all",
  defaultHours: null,
  roiSignals: { commits: false, issues: false },
  ...over,
});
const listed = (...projects: Array<Record<string, unknown>>) => ({
  "project.list": () => ({ projects, maxParallelRuns: 2 }),
});

describe("flightdeckd project update --auto-approve (issue #3515)", () => {
  test("keeps the model and the low-risk rule the project already has, because the daemon fills a missing one with its default", async () => {
    const daemon = fakeDaemon({
      ...listed(
        project({
          autoApprove: { enabled: false, model: "claude-opus-5-5", lowWithoutAi: false },
        }),
      ),
      "project.update": () => project(),
    });
    await runProjectCli(
      { action: "update", project: "api", fields: { autoApprove: { enabled: true } } },
      config(daemon.port),
    );
    expect(calls(daemon, "project.update")[0]?.payload).toEqual({
      projectId: "p1",
      autoApprove: { enabled: true, model: "claude-opus-5-5", lowWithoutAi: false },
    });
  });
});

describe("flightdeckd project add (issue #3515)", () => {
  test("sends the folder made absolute and only the fields the person set, and says what was added", async () => {
    const daemon = fakeDaemon({ "project.add": () => project() });
    const result = await runProjectCli(
      { action: "add", path: "api", fields: { name: "api", baseBranch: "main" } },
      config(daemon.port),
    );
    expect(result.code).toBe(0);
    expect(calls(daemon, "project.add")[0]?.payload).toEqual({
      path: resolve("api"),
      name: "api",
      baseBranch: "main",
    });
    expect(result.out).toEqual(["added api (p1)  /srv/api"]);
  });

  test("--json prints the project the daemon answered", async () => {
    const daemon = fakeDaemon({ "project.add": () => project() });
    const result = await runProjectCli(
      { action: "add", path: "/srv/api", fields: {}, json: true },
      config(daemon.port),
    );
    expect(JSON.parse(result.out.join("\n"))).toMatchObject({ id: "p1", name: "api" });
  });

  test("a folder the daemon refuses exits 1 with its reason", async () => {
    const daemon = fakeDaemon({
      "project.add": () => ({ error: { code: "invalid_state", message: "not a git repository" } }),
    });
    const result = await runProjectCli(
      { action: "add", path: "/srv/x", fields: {} },
      config(daemon.port),
    );
    expect(result.code).toBe(1);
    expect(text(result)).toContain("not a git repository");
  });

  test("an add that got no answer exits 2 and says it may or may not have happened", async () => {
    const silent = fakeDaemon({});
    const result = await runProjectCli(
      { action: "add", path: "/srv/api", fields: {} },
      config(silent.port),
      { timeoutMs: 200 },
    );
    expect(result.code).toBe(2);
    expect(text(result)).toContain("may or may not");
  });
});

describe("flightdeckd project update (issue #3515)", () => {
  test("finds the project by name, sends its id with the fields set, and names them", async () => {
    const daemon = fakeDaemon({
      ...listed(project(), project({ id: "p2", name: "web" })),
      "project.update": () => project({ defaultHours: 8 }),
    });
    const result = await runProjectCli(
      { action: "update", project: "API", fields: { defaultHours: 8, setupScript: null } },
      config(daemon.port),
    );
    expect(result.code).toBe(0);
    expect(calls(daemon, "project.update")[0]?.payload).toEqual({
      projectId: "p1",
      defaultHours: 8,
      setupScript: null,
    });
    expect(result.out).toEqual(["updated api (p1)  changed defaultHours, setupScript"]);
  });

  test("an unknown project exits 1 and changes nothing", async () => {
    const daemon = fakeDaemon({ ...listed(project()), "project.update": () => project() });
    const result = await runProjectCli(
      { action: "update", project: "nope", fields: { name: "x" } },
      config(daemon.port),
    );
    expect(result.code).toBe(1);
    expect(text(result)).toContain('no project named "nope"');
    expect(calls(daemon, "project.update")).toEqual([]);
  });

  test("a name two projects share is refused with their ids", async () => {
    const daemon = fakeDaemon({
      ...listed(project(), project({ id: "p9", path: "/srv/api2" })),
      "project.update": () => project(),
    });
    const result = await runProjectCli(
      { action: "update", project: "api", fields: { name: "x" } },
      config(daemon.port),
    );
    expect(result.code).toBe(1);
    expect(text(result)).toContain("p1, p9");
    expect(calls(daemon, "project.update")).toEqual([]);
  });
});

describe("flightdeckd project detect-provider (issue #3515)", () => {
  const outcomes: Array<[Record<string, unknown>, string]> = [
    [
      { outcome: "set", project: project({ prProvider: "github" }) },
      "api: the PR provider is now github",
    ],
    [
      { outcome: "kept", project: project({ prProvider: "azure-devops" }) },
      "api: the PR provider stays azure-devops",
    ],
    [{ outcome: "no_remote" }, "api: the repository has no origin remote"],
    [
      { outcome: "unsupported", host: "gitlab.com" },
      "api: the origin is on gitlab.com, which is not GitHub or Azure DevOps",
    ],
    [{ outcome: "unreadable" }, "api: git could not read the repository"],
  ];

  for (const [answer, line] of outcomes)
    test(`says what looking at the remote did: ${String(answer.outcome)}`, async () => {
      const daemon = fakeDaemon({
        ...listed(project()),
        "project.detectProvider": () => ({ project: project(), host: null, ...answer }),
      });
      const result = await runProjectCli(
        { action: "detect-provider", project: "api" },
        config(daemon.port),
      );
      expect(result.code).toBe(0);
      expect(calls(daemon, "project.detectProvider")[0]?.payload).toEqual({ projectId: "p1" });
      expect(result.out).toEqual([line]);
    });
});

describe("flightdeckd project harness-draft and harness-export (issue #3515)", () => {
  test("draft prints the digest an apply would repeat, then the drafted CLAUDE.md", async () => {
    const daemon = fakeDaemon({
      "project.harness.draft": () => ({
        path: "CLAUDE.md",
        content: "# api\nrun bun test",
        digest: "abc123",
      }),
    });
    const result = await runProjectCli(
      { action: "harness-draft", path: "/srv/api" },
      config(daemon.port),
    );
    expect(result.code).toBe(0);
    expect(calls(daemon, "project.harness.draft")[0]?.payload).toEqual({
      path: "/srv/api",
      part: "claudeMd",
    });
    expect(result.out).toEqual(["CLAUDE.md  digest abc123", "", "# api", "run bun test"]);
  });

  test("export sends the id and title and lists the template's files", async () => {
    const daemon = fakeDaemon({
      "project.harness.export": () => ({
        id: "web",
        title: "Web stack",
        files: ["CLAUDE.md", "agents/qa.md"],
        bytes: 2048,
      }),
    });
    const result = await runProjectCli(
      { action: "harness-export", path: "/srv/api", id: "web", title: "Web stack" },
      config(daemon.port),
    );
    expect(result.code).toBe(0);
    expect(calls(daemon, "project.harness.export")[0]?.payload).toEqual({
      path: "/srv/api",
      id: "web",
      title: "Web stack",
    });
    expect(result.out).toEqual([
      "exported web  Web stack  2 files, 2048 bytes",
      "  CLAUDE.md",
      "  agents/qa.md",
    ]);
  });

  test("a far connection is refused by the daemon and exits 1 with its reason", async () => {
    const daemon = fakeDaemon({
      "project.harness.export": () => ({
        error: { code: "transport_refused", message: "this command is for a near connection" },
      }),
    });
    const result = await runProjectCli(
      { action: "harness-export", path: "/srv/api", id: "web", title: "Web" },
      config(daemon.port),
    );
    expect(result.code).toBe(1);
    expect(text(result)).toContain("near connection");
  });
});

describe("the project write verbs on the command line (issue #3515)", () => {
  test("add takes a folder and the fields as flags", () => {
    expect(
      parsed([
        "project",
        "add",
        "/srv/api",
        "--name",
        "api",
        "--base-branch",
        "main",
        "--pr-provider",
        "azure-devops",
        "--setup-script",
        "bun install",
        "--prompt-template",
        "be brief",
        "--auto-approve",
        "on",
        "--json",
      ]),
    ).toMatchObject({
      command: "project",
      action: "add",
      projectPaths: ["/srv/api"],
      personaName: "api",
      projectFields: {
        baseBranch: "main",
        prProvider: "azure-devops",
        setupScript: "bun install",
        promptTemplate: "be brief",
        autoApprove: { enabled: true },
      },
      json: true,
    });
  });

  test("update takes the project first; none gives a script or the hours back", () => {
    expect(
      parsed(["project", "update", "api", "--default-hours", "8", "--persona-subagents", "none"]),
    ).toMatchObject({
      action: "update",
      projectRef: "api",
      projectFields: { defaultHours: 8, personaSubagents: "none" },
    });
    expect(
      parsed(["project", "update", "api", "--default-hours", "none", "--setup-script", "none"]),
    ).toMatchObject({ projectFields: { defaultHours: null, setupScript: null } });
  });

  test("detect-provider, harness-draft and harness-export take their operands", () => {
    expect(parsed(["project", "detect-provider", "api", "--host", "pi"])).toMatchObject({
      action: "detect-provider",
      projectRef: "api",
      host: "pi",
    });
    expect(parsed(["project", "harness-draft", "/srv/api"])).toMatchObject({
      action: "harness-draft",
      projectPaths: ["/srv/api"],
    });
    expect(parsed(["project", "harness-export", "/srv/api", "web", "Web stack"])).toMatchObject({
      action: "harness-export",
      projectPaths: ["/srv/api"],
      projectExport: { id: "web", title: "Web stack" },
    });
  });

  test("refuses a missing or extra operand, and an update that changes nothing", () => {
    const refused = (argv: string[], word: string) =>
      expect(parsed(argv)).toMatchObject({ refusedWith: expect.stringContaining(word) });
    refused(["project", "add"], "folder");
    refused(["project", "add", "/a", "/b"], "one folder");
    refused(["project", "update"], "project");
    refused(["project", "update", "api"], "nothing to change");
    refused(["project", "detect-provider"], "project");
    refused(["project", "harness-export", "/a", "web"], "title");
    refused(["project", "harness-export", "/a", "Bad Id", "T"], "id");
    refused(["project", "harness-export", "/a", "web", " "], "title");
  });

  test("refuses a value the protocol would", () => {
    const refused = (argv: string[], word: string) =>
      expect(parsed(argv)).toMatchObject({ refusedWith: expect.stringContaining(word) });
    refused(["project", "add", "/a", "--pr-provider", "gitlab"], "--pr-provider");
    refused(["project", "add", "/a", "--auto-approve", "maybe"], "--auto-approve");
    refused(["project", "update", "api", "--default-hours", "2000"], "--default-hours");
    refused(["project", "update", "api", "--default-hours", "abc"], "--default-hours");
    refused(["project", "update", "api", "--persona-subagents", "some"], "--persona-subagents");
  });

  test("a flag belongs to its verbs only", () => {
    const refused = (argv: string[]) =>
      expect(parsed(argv)).toMatchObject({
        refusedWith: expect.stringContaining("only applies to"),
      });
    refused(["project", "add", "/a", "--default-hours", "8"]);
    refused(["project", "stack", "/a", "--base-branch", "main"]);
    refused(["project", "stack", "/a", "--name", "x"]);
    refused(["project", "trust-state", "/a", "--setup-script", "x"]);
    refused(["card", "list", "--base-branch", "main"]);
  });

  test("a folder for another host must be an absolute path", () => {
    expect(parsed(["project", "add", "./mine", "--host", "pi"])).toMatchObject({
      refusedWith: expect.stringContaining("absolute"),
    });
    expect(parsed(["project", "harness-draft", "./mine", "--host", "pi"])).toMatchObject({
      refusedWith: expect.stringContaining("absolute"),
    });
  });
});
