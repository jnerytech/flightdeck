import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "../../src/server.ts";
import { newManager, tempDir } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import {
  changes,
  everything,
  hashOf,
  lands,
  OK,
  restoreFakes,
  world,
} from "../support/plugins-cli.ts";

setDefaultTimeout(30_000);

const TOKEN = "plugins-near-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  restoreFakes();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * Issue #3815: installing or updating a plugin, or adding a marketplace, brings code that runs in every
 * session (hooks, MCP servers), so it needs a near connection (this computer or Tailscale), as trusting a
 * workflow does. Reading and the previews answer anywhere.
 */
async function nearAndFar() {
  const ctx = newManager();
  const root = realpathSync.native(tempDir("fd-roots-"));
  const w = world(
    (c) =>
      everything(c, [
        { args: ["marketplace", "add"], stdout: OK("marketplace-add") },
        { args: ["install"], stdout: OK("install") },
        { args: ["update"], stdout: OK("update") },
      ]),
    lands,
  );
  const base = {
    manager: ctx.manager,
    agentSetup: { plugins: w.plugins },
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [root],
    allowedNetworks: ["0.0.0.0/0", "::/0"],
  };
  const servers = [startServer(base), startServer({ ...base, peerOf: () => "8.8.8.8" })];
  const clients = servers.map((server) => new FrameClient(server.url));
  cleanups.push(async () => {
    for (const client of clients) client.close();
    for (const server of servers) await server.stop();
  });
  for (const client of clients) await client.request("hello", { token: TOKEN, client: "t" });
  const [near, far] = clients as [FrameClient, FrameClient];
  const reasonOf = async (call: Promise<{ error?: unknown }>) =>
    ((await call).error as { reason?: string } | undefined)?.reason ?? null;
  const done = () =>
    changes(w.fake).filter((c) => /^plugin (install|update|marketplace add) /.test(c));
  return { near, far, w, reasonOf, done };
}

describe("installing, updating and adding a marketplace need a near connection (#3815)", () => {
  test("a far connection cannot install a plugin and nothing runs; a near one installs it", async () => {
    const { near, far, w, reasonOf, done } = await nearAndFar();
    const ask = {
      plugin: "deploy-tools@acme",
      confirmHash: await hashOf(w.marketplace, "deploy-tools"),
    };
    const farInstall = await reasonOf(far.request("plugins.install", ask));
    const afterFar = done();
    const nearInstall = await reasonOf(near.request("plugins.install", ask));
    expect([farInstall, afterFar, nearInstall, done().length]).toEqual([
      "transport_refused",
      [],
      null,
      1,
    ]);
  });

  test("a far connection cannot update a plugin; a near one updates it", async () => {
    const { near, far, w, reasonOf, done } = await nearAndFar();
    writeFileSync(join(w.marketplace, "plugins/deploy-tools/extra.txt"), "novo");
    const ask = {
      plugin: "deploy-tools@acme",
      confirmHash: (await w.plugins.previewUpdate("deploy-tools@acme")).to.hash,
    };
    const farUpdate = await reasonOf(far.request("plugins.update", ask));
    const afterFar = done();
    const nearUpdate = await reasonOf(near.request("plugins.update", ask));
    expect([farUpdate, afterFar, nearUpdate, done().length]).toEqual([
      "transport_refused",
      [],
      null,
      1,
    ]);
  });

  test("a far connection cannot confirm a marketplace add, can still ask for the preview; a near one confirms", async () => {
    const { near, far, reasonOf, done } = await nearAndFar();
    const source = "acme/tools";
    const farConfirm = await reasonOf(
      far.request("plugins.marketplaceAdd", { source, confirm: true }),
    );
    const afterFar = done();
    const farPreview = await reasonOf(far.request("plugins.marketplaceAdd", { source }));
    const nearConfirm = await reasonOf(
      near.request("plugins.marketplaceAdd", { source, confirm: true }),
    );
    expect([
      farConfirm,
      afterFar,
      farPreview === "transport_refused",
      nearConfirm,
      done().length,
    ]).toEqual(["transport_refused", [], false, null, 1]);
  });
});
