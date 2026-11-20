import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { CliResult } from "../../src/daemon-client/index.ts";
import { parseArgs } from "../../src/main.ts";
import { runPluginsCli } from "../../src/plugins/index.ts";
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

const HASH = "a".repeat(64);
const inventory = (over: Record<string, unknown> = {}) => ({
  manifest: { name: "deploy-tools", version: "1.2.0" },
  hooks: [
    {
      event: "PreToolUse",
      matcher: "Bash",
      type: "command",
      command: "./guard.sh",
      sensitive: true,
    },
  ],
  monitors: [{ name: "watch", command: "tail -f log", description: "the log", when: "always" }],
  skills: ["deploy"],
  agents: [],
  commands: ["ship"],
  mcpServers: [{ name: "gh", transport: "stdio", target: "gh-mcp" }],
  attention: true,
  hash: HASH,
  files: 4,
  bytes: 900,
  problems: [],
  ...over,
});
const installed = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: id.split("@")[0],
  marketplace: id.split("@")[1],
  version: "1.2.0",
  scope: "user",
  enabled: true,
  path: "/home/u/.claude/plugins/cache/x",
  pinned: null,
  inventory: inventory(),
  errors: [],
  ...over,
});

describe("flightdeckd plugins list and detail (issue #3516)", () => {
  const list = {
    installed: [
      installed("deploy-tools@acme"),
      installed("lint@acme", {
        enabled: false,
        pinned: { version: "0.9.0", hash: HASH, at: "2026-11-01T00:00:00Z" },
      }),
    ],
    available: [{ id: "extra@acme", name: "extra", marketplace: "acme", description: "more" }],
    marketplaces: [{ name: "acme", source: "github:acme/plugins" }],
  };

  test("list prints the installed, the available and the marketplaces, one line each", async () => {
    const daemon = fakeDaemon({ "plugins.list": () => list });
    const result = await runPluginsCli({ action: "list" }, config(daemon.port));
    expect(result.code).toBe(0);
    expect(calls(daemon, "plugins.list")).toEqual([{ type: "plugins.list", payload: {} }]);
    expect(result.out).toEqual([
      "installed  deploy-tools@acme  1.2.0  user  enabled",
      "installed  lint@acme  1.2.0  user  disabled  pinned 0.9.0",
      "available  extra@acme  more",
      "marketplace  acme  github:acme/plugins",
    ]);
  });

  test("a host with nothing says so, and --json prints the daemon's answer", async () => {
    const empty = { installed: [], available: [], marketplaces: [] };
    const daemon = fakeDaemon({ "plugins.list": () => empty });
    expect((await runPluginsCli({ action: "list" }, config(daemon.port))).out).toEqual([
      "no plugins",
    ]);
    const asJson = await runPluginsCli({ action: "list", json: true }, config(daemon.port));
    expect(asJson.out).toEqual([JSON.stringify(empty, null, 2)]);
  });

  test("detail sends the plugin and prints what it installs", async () => {
    const daemon = fakeDaemon({ "plugins.detail": () => installed("deploy-tools@acme") });
    const result = await runPluginsCli(
      { action: "detail", plugin: "deploy-tools@acme" },
      config(daemon.port),
    );
    expect(calls(daemon, "plugins.detail")[0]?.payload).toEqual({ plugin: "deploy-tools@acme" });
    expect(result.out).toEqual([
      "deploy-tools@acme  1.2.0",
      "scope: user",
      "enabled: yes",
      "path: /home/u/.claude/plugins/cache/x",
      `hash: ${HASH}`,
      "needs your attention: yes",
      "hooks: 1 (1 can decide for you)",
      "monitors: 1",
      "skills: 1",
      "agents: 0",
      "commands: 1",
      "mcp servers: 1",
    ]);
  });

  test("a plugin that is not installed exits 1 with the daemon's code and reason", async () => {
    const daemon = fakeDaemon({
      "plugins.detail": () => ({
        error: { code: "not_found", message: "no such plugin", reason: "plugin_not_installed" },
      }),
    });
    const result = await runPluginsCli(
      { action: "detail", plugin: "nope@acme" },
      config(daemon.port),
    );
    expect(result.code).toBe(1);
    expect(text(result)).toContain("not_found: no such plugin");
  });

  test("a name from a marketplace cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      "plugins.list": () => ({
        ...list,
        available: [
          { id: "x@acme", name: "x", marketplace: "acme", description: "ok\u001b[2J gone" },
        ],
      }),
    });
    const result = await runPluginsCli({ action: "list" }, config(daemon.port));
    expect(text(result)).not.toContain("\u001b");
    expect(text(result)).toContain("ok [2J gone");
  });

  test("no answer exits 2", async () => {
    const silent = fakeDaemon({});
    const result = await runPluginsCli({ action: "list" }, config(silent.port), {
      timeoutMs: 200,
    });
    expect(result.code).toBe(2);
  });
});

describe("flightdeckd plugins preview and preview-update (issue #3516)", () => {
  test("a local plugin prints what an install would bring and the hash to repeat", async () => {
    const daemon = fakeDaemon({
      "plugins.preview": () => ({
        plugin: "deploy-tools@acme",
        version: "1.2.0",
        inventory: inventory({ problems: ["skills/x: no description"] }),
        hash: HASH,
      }),
    });
    const result = await runPluginsCli(
      { action: "preview", plugin: "deploy-tools@acme" },
      config(daemon.port),
    );
    expect(result.code).toBe(0);
    expect(calls(daemon, "plugins.preview")[0]?.payload).toEqual({ plugin: "deploy-tools@acme" });
    expect(result.out).toEqual([
      "deploy-tools@acme  1.2.0",
      `hash: ${HASH}`,
      "needs your attention: yes",
      "hook: PreToolUse Bash command ./guard.sh (can decide for you)",
      "monitor: watch: tail -f log (the log, when always)",
      "skill: deploy",
      "command: ship",
      "mcp server: gh stdio gh-mcp",
      "4 files, 900 bytes",
      "problem: skills/x: no description",
    ]);
  });

  test("a plugin that is not local prints no hash and exits 0", async () => {
    const daemon = fakeDaemon({
      "plugins.preview": () => ({
        plugin: "far@acme",
        inventory: null,
        hash: null,
        reason: "not-local",
      }),
    });
    const result = await runPluginsCli(
      { action: "preview", plugin: "far@acme" },
      config(daemon.port),
    );
    expect(result.code).toBe(0);
    expect(result.out).toEqual([
      "far@acme",
      "not local: its content cannot be shown, so it has no hash",
    ]);
    const asJson = await runPluginsCli(
      { action: "preview", plugin: "far@acme", json: true },
      config(daemon.port),
    );
    expect(JSON.parse(asJson.out.join("\n"))).toEqual({
      plugin: "far@acme",
      inventory: null,
      hash: null,
      reason: "not-local",
    });
  });

  test("a folder is sent as dir, prints the validation, and a refusal outside the roots exits 1", async () => {
    const daemon = fakeDaemon({
      "plugins.preview": (payload) =>
        (payload as { dir: string }).dir === "/srv/mine"
          ? {
              plugin: "mine",
              inventory: inventory(),
              hash: HASH,
              validation: { success: false, errors: ["plugin.json: no name"] },
            }
          : { error: { code: "forbidden_cwd", message: "outside the allowed folders" } },
    });
    const inside = await runPluginsCli(
      { action: "preview", dir: "/srv/mine" },
      config(daemon.port),
    );
    expect(calls(daemon, "plugins.preview")[0]?.payload).toEqual({ dir: "/srv/mine" });
    expect(inside.out).toContain("validation: failed");
    expect(inside.out).toContain("validation error: plugin.json: no name");
    const outside = await runPluginsCli({ action: "preview", dir: "/etc" }, config(daemon.port));
    expect(outside.code).toBe(1);
    expect(text(outside)).toContain("forbidden_cwd: outside the allowed folders");
  });

  test("preview-update prints from, to and what changed, or that nothing did", async () => {
    const delta = (added: string[] = [], removed: string[] = []) => ({ added, removed });
    const answer = (over: Record<string, unknown>) => ({
      plugin: "deploy-tools@acme",
      from: { version: "1.2.0", hash: "b".repeat(64) },
      to: { version: "1.3.0", hash: HASH },
      inventory: inventory(),
      diff: {
        hooks: delta(["Stop ./bye.sh"]),
        monitors: delta(),
        skills: delta([], ["old"]),
        agents: delta(),
        commands: delta(),
        mcpServers: delta(),
      },
      unchanged: false,
      ...over,
    });
    const changed = fakeDaemon({ "plugins.previewUpdate": () => answer({}) });
    const result = await runPluginsCli(
      { action: "preview-update", plugin: "deploy-tools@acme" },
      config(changed.port),
    );
    expect(calls(changed, "plugins.previewUpdate")[0]?.payload).toEqual({
      plugin: "deploy-tools@acme",
    });
    expect(result.out).toEqual([
      "deploy-tools@acme",
      `from: 1.2.0 ${"b".repeat(64)}`,
      `to: 1.3.0 ${HASH}`,
      "hooks: added Stop ./bye.sh",
      "skills: removed old",
    ]);
    const same = fakeDaemon({ "plugins.previewUpdate": () => answer({ unchanged: true }) });
    const none = await runPluginsCli(
      { action: "preview-update", plugin: "deploy-tools@acme" },
      config(same.port),
    );
    expect(none.out.at(-1)).toBe("unchanged: the marketplace's copy is the installed one");
  });
});

describe("flightdeckd plugins command line (issue #3516)", () => {
  test("the verbs and what they take", () => {
    expect(parsed(["plugins", "list", "--json"])).toMatchObject({
      command: "plugins",
      action: "list",
      json: true,
    });
    expect(parsed(["plugins", "detail", "a@b"])).toMatchObject({ action: "detail", plugin: "a@b" });
    expect(parsed(["plugins", "preview", "a@b"])).toMatchObject({
      action: "preview",
      plugin: "a@b",
    });
    expect(parsed(["plugins", "preview", "--dir", "/srv/mine"])).toMatchObject({
      action: "preview",
      pluginDir: "/srv/mine",
    });
    expect(parsed(["plugins", "preview-update", "a@b", "--host", "pi"])).toMatchObject({
      action: "preview-update",
      plugin: "a@b",
      host: "pi",
    });
  });

  test("a preview names a plugin or a folder, one of the two", () => {
    for (const argv of [
      ["plugins", "preview"],
      ["plugins", "preview", "a@b", "--dir", "/x"],
    ])
      expect(parsed(argv)).toMatchObject({
        refusedWith: expect.stringContaining("plugin or --dir"),
      });
  });

  test("an unknown verb, a missing plugin and a stray --dir are refused", () => {
    expect(parsed(["plugins", "nuke"])).toMatchObject({
      refusedWith: expect.stringContaining("invalid plugins action: nuke"),
    });
    expect(parsed(["plugins", "detail"])).toMatchObject({
      refusedWith: expect.stringContaining("missing the plugin"),
    });
    expect(parsed(["plugins", "detail", "a@b", "--dir", "/x"])).toMatchObject({
      refusedWith: expect.stringContaining(
        "--dir: this flag only applies to flightdeckd plugins preview",
      ),
    });
    expect(parsed(["history", "list", "--dir", "/x"])).toMatchObject({
      refusedWith: expect.stringContaining(
        "--dir: this flag only applies to flightdeckd plugins preview",
      ),
    });
  });
});
