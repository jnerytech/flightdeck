import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { resolve } from "node:path";
import { projectCliArgs } from "../../src/cli/domain/project-args.ts";
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

const load = (over: Record<string, unknown> = {}) => ({
  path: "/p",
  hooks: [],
  mcpServers: [],
  envKeys: [],
  allowRules: [],
  defaultMode: null,
  agents: [],
  skills: [],
  commands: [],
  claudeMd: false,
  executables: [],
  redirects: [],
  plugins: [],
  otherKeys: [],
  extras: [],
  unreadable: [],
  omitted: { hooks: 0, mcpServers: 0, allowRules: 0, envKeys: 0 },
  ...over,
});

describe("flightdeckd project trust-state (issue #3515)", () => {
  const answer = {
    items: [
      { path: "/srv/a", trusted: true, via: "/srv" },
      { path: "/srv/b", trusted: false, via: null },
      { path: "/srv/c", trusted: false, via: null, staleSessions: 2 },
    ],
  };

  test("sends the folders and prints one line each: trusted and through which record, not trusted, stale sessions", async () => {
    const daemon = fakeDaemon({ "project.trust.state": () => answer });
    const result = await runProjectCli(
      { action: "trust-state", paths: ["/srv/a", "/srv/b", "/srv/c"] },
      config(daemon.port),
    );
    expect(result.code).toBe(0);
    expect(calls(daemon, "project.trust.state")[0]?.payload).toEqual({
      paths: ["/srv/a", "/srv/b", "/srv/c"],
    });
    expect(result.out).toEqual([
      "/srv/a  trusted  via /srv",
      "/srv/b  not trusted",
      "/srv/c  not trusted  2 sessions still run with the setup they loaded",
    ]);
  });

  test("a relative folder means the shell's, so it is sent absolute", async () => {
    const daemon = fakeDaemon({ "project.trust.state": () => ({ items: [] }) });
    await runProjectCli({ action: "trust-state", paths: ["./mine"] }, config(daemon.port));
    expect(calls(daemon, "project.trust.state")[0]?.payload).toEqual({
      paths: [resolve("./mine")],
    });
  });

  test("--json prints the daemon's answer whole", async () => {
    const daemon = fakeDaemon({ "project.trust.state": () => answer });
    const result = await runProjectCli(
      { action: "trust-state", paths: ["/srv/a"], json: true },
      config(daemon.port),
    );
    expect(result.out).toEqual([JSON.stringify(answer, null, 2)]);
  });
});

describe("flightdeckd project stack (issue #3515)", () => {
  test("prints the stacks and the four commands, a dash for one the host did not find", async () => {
    const daemon = fakeDaemon({
      "project.harness.stack": () => ({
        stacks: ["node", "python"],
        commands: { test: "bun test", lint: null, format: null, build: "bun run build" },
      }),
    });
    const result = await runProjectCli({ action: "stack", path: "/p" }, config(daemon.port));
    expect(calls(daemon, "project.harness.stack")[0]?.payload).toEqual({ path: "/p" });
    expect(result.out).toEqual([
      "stacks  node, python",
      "test    bun test",
      "lint    -",
      "format  -",
      "build   bun run build",
    ]);
  });

  test("a folder with no known stack says so", async () => {
    const daemon = fakeDaemon({
      "project.harness.stack": () => ({
        stacks: [],
        commands: { test: null, lint: null, format: null, build: null },
      }),
    });
    const result = await runProjectCli({ action: "stack", path: "/p" }, config(daemon.port));
    expect(result.out[0]).toBe("stacks  none detected");
  });

  test("a folder outside the allowed folders exits 1 with the daemon's code and message", async () => {
    const daemon = fakeDaemon({
      "project.harness.stack": () => ({
        error: { code: "forbidden_cwd", message: "outside the allowed folders" },
      }),
    });
    const result = await runProjectCli({ action: "stack", path: "/etc" }, config(daemon.port));
    expect(result.code).toBe(1);
    expect(text(result)).toContain("forbidden_cwd: outside the allowed folders");
  });
});

describe("flightdeckd project trust-inspect (issue #3515)", () => {
  test("names every hook command, server, program, redirect and rule the folder would load", async () => {
    const file = ".claude/settings.json";
    const daemon = fakeDaemon({
      "project.trust.inspect": () =>
        load({
          hooks: [{ event: "PreToolUse", file, commands: ["./guard.sh", "./b.sh"] }],
          mcpServers: [{ name: "gh", file: ".mcp.json", command: "gh-mcp" }],
          executables: [{ key: "apiKeyHelper", file, command: "./key.sh" }],
          redirects: [{ key: "ANTHROPIC_BASE_URL", file, value: "https://proxy.example" }],
          allowRules: ["Bash(ls)", "Read"],
          denyRules: ["Bash(rm *)"],
          defaultMode: "acceptEdits",
          envKeys: ["A"],
          agents: ["rev"],
          skills: ["s1", "s2"],
          claudeMd: true,
          plugins: ["x@y"],
          otherKeys: ["foo"],
          extras: [{ file: ".claude/agents/rev.md", keys: ["hooks"] }],
          unreadable: ["bad.json"],
          omitted: { hooks: 2, mcpServers: 0, allowRules: 1, envKeys: 0 },
        }),
    });
    const result = await runProjectCli(
      { action: "trust-inspect", path: "/p" },
      config(daemon.port),
    );
    expect(calls(daemon, "project.trust.inspect")[0]?.payload).toEqual({ path: "/p" });
    expect(result.out).toEqual([
      "/p",
      "hooks: 2",
      "  PreToolUse  .claude/settings.json  ./guard.sh",
      "  PreToolUse  .claude/settings.json  ./b.sh",
      "mcp servers: 1",
      "  gh  .mcp.json  gh-mcp",
      "executables: 1",
      "  apiKeyHelper  .claude/settings.json  ./key.sh",
      "redirects: 1",
      "  ANTHROPIC_BASE_URL  .claude/settings.json  https://proxy.example",
      "allow rules: 2",
      "  Bash(ls)",
      "  Read",
      "deny rules: 1",
      "  Bash(rm *)",
      "default mode: acceptEdits",
      "env keys: A",
      "agents: rev",
      "skills: s1, s2",
      "claude.md: yes",
      "plugins: x@y",
      "other settings: foo",
      "extras: .claude/agents/rev.md (hooks)",
      "unreadable: bad.json",
      "left out of the lists: hooks 2, allow rules 1",
    ]);
  });

  test("a folder that loads nothing says so", async () => {
    const daemon = fakeDaemon({ "project.trust.inspect": () => load() });
    const result = await runProjectCli(
      { action: "trust-inspect", path: "/p" },
      config(daemon.port),
    );
    expect(result.out).toEqual(["/p", "loads nothing"]);
  });

  test("--json prints the daemon's answer whole", async () => {
    const answer = load({ claudeMd: true });
    const daemon = fakeDaemon({ "project.trust.inspect": () => answer });
    const result = await runProjectCli(
      { action: "trust-inspect", path: "/p", json: true },
      config(daemon.port),
    );
    expect(result.out).toEqual([JSON.stringify(answer, null, 2)]);
  });
});

describe("flightdeckd project harness-preview (issue #3515)", () => {
  const preview = {
    settings: {
      path: ".claude/settings.json",
      hash: null,
      hooks: [{ event: "PreToolUse", matcher: "Bash", command: "./guard.sh" }],
      denyRules: ["Bash(rm *)"],
      conflicts: ["hooks"],
      reformats: true,
      digest: "d1",
    },
    files: [{ path: "CLAUDE.md", content: "# a\n# b\n", digest: "d2" }],
    unreadable: ["x.md"],
    withheld: [{ path: ".claude/skills/s/SKILL.md", reason: "secret" }],
  };

  test("sends the parts and the template, and prints what applying would add without the files' text", async () => {
    const daemon = fakeDaemon({ "project.harness.preview": () => preview });
    const result = await runProjectCli(
      { action: "harness-preview", path: "/p", parts: ["claudeMd", "hooks"], template: "web" },
      config(daemon.port),
    );
    expect(calls(daemon, "project.harness.preview")[0]?.payload).toEqual({
      path: "/p",
      parts: ["claudeMd", "hooks"],
      template: "web",
    });
    expect(result.out).toEqual([
      ".claude/settings.json  hash none  digest d1",
      "  hook  PreToolUse  Bash  ./guard.sh",
      "  deny  Bash(rm *)",
      "  conflict  hooks",
      "  the file would be rewritten with another layout",
      "file  CLAUDE.md  8 bytes  digest d2",
      "unreadable  x.md",
      "withheld  .claude/skills/s/SKILL.md  secret",
    ]);
  });

  test("without a template none is sent, and an empty preview says nothing would change", async () => {
    const daemon = fakeDaemon({
      "project.harness.preview": () => ({ settings: null, files: [], unreadable: [] }),
    });
    const result = await runProjectCli(
      { action: "harness-preview", path: "/p", parts: ["agents"] },
      config(daemon.port),
    );
    expect(calls(daemon, "project.harness.preview")[0]?.payload).toEqual({
      path: "/p",
      parts: ["agents"],
    });
    expect(result.out).toEqual(["nothing to add"]);
  });

  test("a template needs the near connection: the daemon's refusal exits 1", async () => {
    const daemon = fakeDaemon({
      "project.harness.preview": () => ({
        error: { code: "forbidden", message: "this needs a near connection" },
      }),
    });
    const result = await runProjectCli(
      { action: "harness-preview", path: "/p", parts: ["claudeMd"], template: "web" },
      config(daemon.port),
    );
    expect(result.code).toBe(1);
    expect(text(result)).toContain("forbidden: this needs a near connection");
  });
});

describe("the project verbs on the command line (issue #3515)", () => {
  test("the verbs and what they take", () => {
    expect(parsed(["project", "trust-state", "/a", "/b", "--json"])).toMatchObject({
      command: "project",
      action: "trust-state",
      projectPaths: ["/a", "/b"],
      json: true,
    });
    expect(parsed(["project", "stack", "/a"])).toMatchObject({
      action: "stack",
      projectPaths: ["/a"],
    });
    expect(parsed(["project", "trust-inspect", "/a", "--host", "pi"])).toMatchObject({
      action: "trust-inspect",
      projectPaths: ["/a"],
      host: "pi",
    });
    expect(
      parsed([
        "project",
        "harness-preview",
        "/a",
        "--parts",
        "claudeMd,hooks",
        "--template",
        "web",
      ]),
    ).toMatchObject({
      action: "harness-preview",
      projectPaths: ["/a"],
      projectParts: ["claudeMd", "hooks"],
      projectTemplate: "web",
    });
  });

  test("a verb without its folder, a second folder where one is read, and a missing or unknown part are refused", () => {
    for (const [argv, said] of [
      [["project", "stack"], "folder"],
      [["project", "trust-state"], "folder"],
      [["project", "stack", "/a", "/b"], "one folder"],
      [["project", "harness-preview", "/a"], "--parts"],
      [["project", "harness-preview", "/a", "--parts", "mcp"], "invalid part"],
      [["project", "harness-preview", "/a", "--parts", "hooks,hooks"], "invalid part"],
      [
        ["project", "harness-preview", "/a", "--parts", "hooks", "--template", "Bad Id"],
        "template",
      ],
      [["project", "nope"], "invalid project action"],
    ] as const)
      expect(parsed([...argv])).toMatchObject({ refusedWith: expect.stringContaining(said) });
  });

  test("--parts and --template belong to harness-preview only", () => {
    expect(parsed(["project", "stack", "/a", "--parts", "hooks"])).toMatchObject({
      refusedWith: expect.stringContaining("only applies to"),
    });
    expect(parsed(["project", "trust-state", "/a", "--template", "web"])).toMatchObject({
      refusedWith: expect.stringContaining("only applies to"),
    });
  });

  test("a folder read on another host must be an absolute path", () => {
    expect(parsed(["project", "stack", "./mine", "--host", "pi"])).toMatchObject({
      refusedWith: expect.stringContaining("absolute"),
    });
    expect(parsed(["project", "trust-state", "/srv/mine", "./x", "--host", "pi"])).toMatchObject({
      refusedWith: expect.stringContaining("absolute"),
    });
    expect(parsed(["project", "stack", "/srv/mine", "--host", "pi"])).toMatchObject({
      projectPaths: ["/srv/mine"],
      host: "pi",
    });
  });

  test("a Windows host's drive path is absolute there, though this machine would not say so", () => {
    expect(parsed(["project", "stack", "C:\\work\\app", "--host", "winbox"])).toMatchObject({
      projectPaths: ["C:\\work\\app"],
      host: "winbox",
    });
  });
});

describe("what the parsed project words become for the runner (issue #3515)", () => {
  const runnerArgs = (argv: string[]) => projectCliArgs(parseArgs(argv));

  test("trust-state keeps every folder, the others one, and --json is carried", () => {
    expect(runnerArgs(["project", "trust-state", "/a", "/b", "--json"])).toEqual({
      action: "trust-state",
      paths: ["/a", "/b"],
      json: true,
    });
    expect(runnerArgs(["project", "stack", "/a"])).toEqual({ action: "stack", path: "/a" });
    expect(runnerArgs(["project", "trust-inspect", "/a", "--json"])).toEqual({
      action: "trust-inspect",
      path: "/a",
      json: true,
    });
  });

  test("harness-preview carries its parts, and the template only when one was named", () => {
    expect(runnerArgs(["project", "harness-preview", "/a", "--parts", "hooks,agents"])).toEqual({
      action: "harness-preview",
      path: "/a",
      parts: ["hooks", "agents"],
    });
    expect(
      runnerArgs(["project", "harness-preview", "/a", "--parts", "claudeMd", "--template", "web"]),
    ).toEqual({ action: "harness-preview", path: "/a", parts: ["claudeMd"], template: "web" });
  });
});
