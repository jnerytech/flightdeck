import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type FakeCli, installFakeCli } from "../../../../scripts/test/fake-cli.ts";
import { startDaemon } from "../../src/main.ts";
import { claudeCli } from "../../src/plugins/adapters/claude-plugin.ts";
import { pluginDecisionLog } from "../../src/plugins/adapters/decision-log.ts";
import { filePins } from "../../src/plugins/adapters/pin-store.ts";
import { inspectPlugin } from "../../src/plugins/inventory.ts";
import { Plugins } from "../../src/plugins/plugins.ts";
import { startServer } from "../../src/server.ts";
import { gitRepo, newBoard } from "../support/board-helpers.ts";
import { BASELINE_FEATURES, tempDir } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { MANIFEST, plugin, skill } from "../support/plugin-fixtures.ts";

describe("plugins: protocolo", () => {
  const TOKEN = "plugins-token-0123456789abcdef";
  const fakes: FakeCli[] = [];
  const stops: Array<() => unknown> = [];
  afterEach(async () => {
    for (const fake of fakes.splice(0)) fake.restore();
    for (const stop of stops.splice(0).reverse()) await stop();
  });

  const marketplaceOf = () => {
    const marketplace = join(tempDir("fd-market-"), "acme");
    for (const [path, body] of Object.entries({
      ".claude-plugin/marketplace.json": JSON.stringify({
        name: "acme",
        plugins: [{ name: "deploy-tools", source: "./plugins/deploy-tools" }],
      }),
      "plugins/deploy-tools/.claude-plugin/plugin.json": MANIFEST,
      "plugins/deploy-tools/skills/deploy/SKILL.md": skill("deploy"),
    })) {
      mkdirSync(dirname(join(marketplace, path)), { recursive: true });
      writeFileSync(join(marketplace, path), body);
    }
    return marketplace;
  };
  const claude = (marketplace: string) => {
    const installed = plugin({
      ".claude-plugin/plugin.json": MANIFEST,
      "skills/deploy/SKILL.md": skill("deploy"),
    });
    const fake = installFakeCli("claude", [
      {
        args: ["install"],
        stdout: `${JSON.stringify({ command: "install", outcome: "ok", message: "instalado" })}\n`,
      },
      {
        args: ["marketplace", "list"],
        stdout: JSON.stringify([
          { name: "acme", source: "directory", installLocation: marketplace },
        ]),
      },
      {
        args: ["list", "--json"],
        stdout: JSON.stringify({
          installed: [
            {
              id: "deploy-tools@acme",
              version: "1.2.0",
              scope: "user",
              enabled: true,
              installPath: installed,
            },
          ],
          available: [],
        }),
      },
    ]);
    fakes.push(fake);
    return fake;
  };

  async function served(withPlugins = true) {
    const marketplace = marketplaceOf();
    const fake = claude(marketplace);
    const pins = join(tempDir("fd-pins-"), "pins.json");
    const { board, manager } = newBoard();
    const server = startServer({
      manager,
      board,
      ...(withPlugins
        ? { agentSetup: { plugins: new Plugins({ cli: claudeCli(), pins: filePins(pins) }) } }
        : {}),
      features: undefined,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    stops.push(() => server.stop());
    const client = new FrameClient(server.url);
    stops.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    return { client, fake, marketplace, pins };
  }

  test("host.info anuncia plugins só quando o gerenciador está ligado", async () => {
    const on = await served();
    expect(
      (await on.client.data<{ features: string[] }>("host.info", {}))?.features.filter(
        (name) => !BASELINE_FEATURES.includes(name),
      ),
    ).toContain("plugins");
    const off = await served(false);
    expect(
      (await off.client.data<{ features: string[] }>("host.info", {}))?.features.filter(
        (name) => !BASELINE_FEATURES.includes(name),
      ),
    ).not.toContain("plugins");
    expect(await off.client.request("plugins.list", {})).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
  });

  test("plugins.list, detail e preview respondem o que o gerenciador calcula; preview pede plugin ou dir, um dos dois", async () => {
    const { client, marketplace } = await served();
    const list = await client.data<{
      installed: Array<{ id: string; inventory: { skills: string[] } }>;
    }>("plugins.list", {});
    expect(list?.installed.map((p) => [p.id, p.inventory.skills])).toEqual([
      ["deploy-tools@acme", ["deploy"]],
    ]);
    expect(
      await client.data<{ id: string }>("plugins.detail", { plugin: "deploy-tools@acme" }),
    ).toMatchObject({ id: "deploy-tools@acme", version: "1.2.0" });
    expect(await client.data("plugins.preview", { plugin: "deploy-tools@acme" })).toMatchObject({
      plugin: "deploy-tools@acme",
      hash: (await inspectPlugin(join(marketplace, "plugins/deploy-tools"))).hash,
    });
    expect(await client.request("plugins.preview", {})).toMatchObject({
      ok: false,
      error: { code: "bad_request" },
    });
    expect(await client.request("plugins.preview", { plugin: "a@b", dir: "/x" })).toMatchObject({
      ok: false,
      error: { code: "bad_request" },
    });
  });

  test("plugins.install recusa um hash que não é o mostrado e, com o certo, instala sem -y", async () => {
    const { client, fake, marketplace } = await served();
    expect(
      await client.request("plugins.install", {
        plugin: "deploy-tools@acme",
        confirmHash: "errado",
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    const hash = (await inspectPlugin(join(marketplace, "plugins/deploy-tools"))).hash;
    expect(
      await client.data("plugins.install", { plugin: "deploy-tools@acme", confirmHash: hash }),
    ).toEqual({ outcome: "ok", message: "instalado" });
    const sent = fake
      .calls()
      .map((c) => c.join(" "))
      .filter((c) => c.startsWith("plugin install"));
    expect(sent).toEqual(["plugin install deploy-tools@acme --scope user --json"]);
  });

  test("plugins.pin guarda no arquivo; plugins.uninstall sem confirm é recusado", async () => {
    const { client, pins } = await served();
    expect(
      await client.data<{ pinned: { version: string } }>("plugins.pin", {
        plugin: "deploy-tools@acme",
        pinned: true,
      }),
    ).toMatchObject({ pinned: { version: "1.2.0" } });
    expect(Object.keys(await filePins(pins).all())).toEqual(["deploy-tools@acme"]);
    expect(
      await client.request("plugins.uninstall", { plugin: "deploy-tools@acme" }),
    ).toMatchObject({ ok: false, error: { code: "invalid_state" } });
  });

  test("o registro das decisões do plugin é uma linha de JSON por decisão", async () => {
    const file = join(tempDir("fd-log-"), "dados", "plugin-decisions.jsonl");
    const record = pluginDecisionLog(file);
    await record({ action: "install", target: "x@m", hash: "h", at: "2026-10-31T12:00:00.000Z" });
    await record({ action: "uninstall", target: "x@m", at: "2026-10-31T12:01:00.000Z" });
    expect(existsSync(file)).toBe(true);
    expect(
      readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l).action),
    ).toEqual(["install", "uninstall"]);
  });

  test("o daemon inteiro anuncia plugins, lista pela CLI e guarda fixados e decisões ao lado dos dados", async () => {
    const marketplace = marketplaceOf();
    claude(marketplace);
    const base = tempDir("fd-daemon-");
    const { repo } = gitRepo();
    const config = join(base, "config.json");
    writeFileSync(
      config,
      JSON.stringify({
        hostName: "h",
        port: 0,
        token: TOKEN,
        dataDir: join(base, "data"),
        allowedRoots: [join(repo, "..")],
        runtime: "fake",
        hooks: { port: 0 },
      }),
    );
    const daemon = await startDaemon(
      { command: "start", config, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
    );
    stops.push(() => daemon.stop());
    const client = new FrameClient(daemon.url);
    stops.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    expect(
      (await client.data<{ features: string[] }>("host.info", {}))?.features.filter(
        (name) => !BASELINE_FEATURES.includes(name),
      ),
    ).toContain("plugins");
    await client.data("plugins.pin", { plugin: "deploy-tools@acme", pinned: true });
    expect(
      Object.keys(JSON.parse(readFileSync(join(base, "data", "plugin-pins.json"), "utf8"))),
    ).toEqual(["deploy-tools@acme"]);
    const hash = (await inspectPlugin(join(marketplace, "plugins/deploy-tools"))).hash;
    await client.data("plugins.install", { plugin: "deploy-tools@acme", confirmHash: hash });
    expect(existsSync(join(base, "data", "plugin-decisions.jsonl"))).toBe(true);
    const log = readFileSync(join(base, "data", "plugin-decisions.jsonl"), "utf8").trim();
    expect(JSON.parse(log)).toMatchObject({ action: "install", target: "deploy-tools@acme", hash });
  });
});
