import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commandDigest, commandMessage } from "@flightdeck/protocol";
import { Approvers } from "../../src/permissions/approvers.ts";
import { keyIdOf } from "../../src/permissions/domain/approval-gate.ts";
import { startServer } from "../../src/server.ts";
import { newManager, tempDir } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { MANIFEST } from "../support/plugin-fixtures.ts";
import {
  type calls,
  changes,
  everything,
  hashOf,
  lands,
  OK,
  restoreFakes,
  world,
} from "../support/plugins-cli.ts";

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  restoreFakes();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * Issue #3516: with a device enrolled, installing and updating a plugin run only with the signed proof of
 * that device over the whole request, checked once the content the person confirmed is the content the host
 * would fetch; with no device nothing changes. The folder the person signs is the folder the host installs.
 */
const TOKEN = "plugins-proof-token-0123456789abcdef";
type Command = "plugins.install" | "plugins.update";

async function host(options: { enrolled?: boolean } = {}) {
  const ctx = newManager();
  const root = realpathSync.native(tempDir("fd-roots-"));
  const w = world(
    (c) =>
      everything(c, [
        { args: ["marketplace", "update"], stdout: OK("marketplace-update") },
        { args: ["install"], stdout: OK("install") },
        { args: ["update"], stdout: OK("update") },
        { args: ["uninstall"], stdout: OK("uninstall") },
      ]),
    lands,
  );
  let n = 0;
  const approvers = new Approvers(ctx.store.db, {
    now: () => new Date(),
    mono: () => performance.now(),
    random: () => `nonce-${++n}`,
  });
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const keyId = keyIdOf(spki);
  if (options.enrolled !== false) {
    approvers.store.add({
      keyId,
      publicKey: spki,
      name: "phone",
      client: "app",
      address: "127.0.0.1",
      enrolledAt: new Date().toISOString(),
    });
  }
  const server = startServer({
    manager: ctx.manager,
    approvers,
    agentSetup: { plugins: w.plugins },
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [root],
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "flightdeck-app" });
  const daemonId = approvers.list().daemonId;
  /** The proof of the device over `command` and `signed`, with a nonce asked of the host. */
  const prove = async (command: Command, signed: Record<string, unknown>) => {
    const ack = await client.request("approval.challenge", { purpose: "command", command });
    expect(ack.ok).toBe(true);
    const nonce = (ack.data as { nonce: string }).nonce;
    const message = commandMessage({
      keyId,
      daemonId,
      command,
      nonce,
      payloadHash: createHash("sha256").update(commandDigest(signed)).digest("hex"),
    });
    const signature = sign("sha256", Buffer.from(message), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64");
    return { keyId, nonce, signature };
  };
  const hash = () => hashOf(w.marketplace, "deploy-tools");
  /** A newer copy in the marketplace, and the hash the person confirms for it. */
  const newer = async () => {
    writeFileSync(join(w.marketplace, "plugins/deploy-tools/extra.txt"), "novo");
    return (await w.plugins.previewUpdate("deploy-tools@acme")).to.hash;
  };
  return { client, prove, root, hash, newer, ...w };
}

const failure = (ack: Record<string, unknown>) =>
  ack.ok === false ? JSON.stringify((ack as { error?: unknown }).error) : "";
const installs = (t: { fake: Parameters<typeof calls>[0] }) =>
  changes(t.fake).filter((c) => /^plugin (install|update) /.test(c));

describe("command-proof-plugins: installing and updating a plugin with a device enrolled takes its signed proof (#3516)", () => {
  test("with a device enrolled, an install without a proof is refused and nothing is installed", async () => {
    const t = await host();
    const ack = await t.client.request("plugins.install", {
      plugin: "deploy-tools@acme",
      confirmHash: await t.hash(),
    });
    expect([failure(ack).includes("approval_proof_required"), installs(t)]).toEqual([true, []]);
  });

  test("with a device enrolled, an install signed for this request installs the plugin", async () => {
    const t = await host();
    const signed = { plugin: "deploy-tools@acme", confirmHash: await t.hash(), scope: "project" };
    const proof = await t.prove("plugins.install", signed);
    const ack = await t.client.request("plugins.install", { ...signed, proof });
    expect([ack.ok, installs(t)]).toEqual([
      true,
      ["plugin install deploy-tools@acme --scope project --json"],
    ]);
  });

  test("a proof covers the whole request: one signed without a scope or an accepted command does not carry them", async () => {
    const t = await host();
    const signed = { plugin: "deploy-tools@acme", confirmHash: await t.hash() };
    const wider = await t.client.request("plugins.install", {
      ...signed,
      scope: "user",
      proof: await t.prove("plugins.install", signed),
    });
    expect([failure(wider).includes("approval_proof_required"), installs(t)]).toEqual([true, []]);
    const accepted = await t.client.request("plugins.install", {
      ...signed,
      acceptCommand: "c".repeat(64),
      proof: await t.prove("plugins.install", signed),
    });
    expect([failure(accepted).includes("approval_proof_required"), installs(t)]).toEqual([
      true,
      [],
    ]);
  });

  test("a content hash that is not the one shown is refused before the proof is checked, so the challenge is not spent", async () => {
    const t = await host();
    const signed = { plugin: "deploy-tools@acme", confirmHash: "0".repeat(64) };
    const proof = await t.prove("plugins.install", signed);
    const stale = await t.client.request("plugins.install", { ...signed, proof });
    expect([failure(stale).includes("plugin_content_changed"), installs(t)]).toEqual([true, []]);
    const right = { plugin: "deploy-tools@acme", confirmHash: await t.hash() };
    const ack = await t.client.request("plugins.install", {
      ...right,
      proof: await t.prove("plugins.install", right),
    });
    expect([ack.ok, installs(t).length]).toEqual([true, 1]);
  });

  test("a proof is spent once: the same signed install cannot run twice", async () => {
    const t = await host();
    const signed = { plugin: "deploy-tools@acme", confirmHash: await t.hash() };
    const proof = await t.prove("plugins.install", signed);
    const first = await t.client.request("plugins.install", { ...signed, proof });
    const second = await t.client.request("plugins.install", { ...signed, proof });
    expect([first.ok, second.ok, installs(t).length]).toEqual([true, false, 1]);
  });

  test("a folder that resolves to another one is refused with the folder it is, before any proof", async () => {
    const t = await host();
    const real = join(t.root, "mine");
    mkdirSync(join(real, ".claude-plugin"), { recursive: true });
    writeFileSync(join(real, ".claude-plugin/plugin.json"), MANIFEST);
    const link = join(t.root, "link");
    symlinkSync(real, link);
    const signed = { dir: link, confirmHash: "0".repeat(64) };
    const ack = await t.client.request("plugins.install", {
      ...signed,
      proof: await t.prove("plugins.install", signed),
    });
    expect([
      failure(ack).includes("plugin_path_differs"),
      failure(ack).includes(real),
      installs(t),
    ]).toEqual([true, true, []]);
  });

  test("with a device enrolled, an update without a proof is refused, and one signed for this request updates", async () => {
    const t = await host();
    const to = await t.newer();
    const bare = await t.client.request("plugins.update", {
      plugin: "deploy-tools@acme",
      confirmHash: to,
    });
    expect([failure(bare).includes("approval_proof_required"), installs(t)]).toEqual([true, []]);
    const signed = { plugin: "deploy-tools@acme", confirmHash: to };
    const ack = await t.client.request("plugins.update", {
      ...signed,
      proof: await t.prove("plugins.update", signed),
    });
    expect([ack.ok, installs(t)]).toEqual([true, ["plugin update deploy-tools@acme --json"]]);
  });

  test("a pinned plugin is refused as before, with the challenge unspent", async () => {
    const t = await host();
    const to = await t.newer();
    await t.pins.set("deploy-tools@acme", {
      version: "1.2.0",
      hash: "a".repeat(64),
      at: "2026-10-31T12:00:00.000Z",
    });
    const signed = { plugin: "deploy-tools@acme", confirmHash: to };
    const ack = await t.client.request("plugins.update", {
      ...signed,
      proof: await t.prove("plugins.update", signed),
    });
    expect([failure(ack).includes("plugin_pinned"), installs(t)]).toEqual([true, []]);
  });

  test("with no device enrolled, install and update need no proof", async () => {
    const t = await host({ enrolled: false });
    const install = await t.client.request("plugins.install", {
      plugin: "deploy-tools@acme",
      confirmHash: await t.hash(),
    });
    const to = await t.newer();
    const update = await t.client.request("plugins.update", {
      plugin: "deploy-tools@acme",
      confirmHash: to,
    });
    expect([install.ok, update.ok, installs(t).length]).toEqual([true, true, 2]);
  });

  test("the host announces that it checks the proof of these two commands", async () => {
    const t = await host();
    const info = await t.client.data<{ features: string[] }>("host.info", {});
    expect(info?.features.includes("approval-plugins")).toBe(true);
  });
});
