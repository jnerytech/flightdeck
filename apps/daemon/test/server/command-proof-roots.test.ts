import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { commandDigest, commandMessage, FEATURE_APPROVAL_ROOTS } from "@flightdeck/protocol";
import { Approvers } from "../../src/permissions/approvers.ts";
import { keyIdOf } from "../../src/permissions/domain/approval-gate.ts";
import { startServer } from "../../src/server.ts";
import { newManager, tempDir, testRootsPlatform } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * Issue #3507: with a device enrolled, adding an allowed folder (`roots.add`) runs only with the signed proof
 * of that device over the payload; with no device nothing changes. The folder the person signs is the folder
 * the host stores.
 */
const TOKEN = "roots-proof-token-0123456789abcdef";

async function host(options: { enrolled?: boolean } = {}) {
  const ctx = newManager();
  const roots = [ctx.root];
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
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: roots,
    roots: { persist: () => undefined, platform: testRootsPlatform() },
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "flightdeck-app" });
  const daemonId = approvers.list().daemonId;
  /** The proof of the device over `roots.add` and `signed`, with a nonce asked of the host. */
  const prove = async (signed: Record<string, unknown>) => {
    const ack = await client.request("approval.challenge", {
      purpose: "command",
      command: "roots.add",
    });
    expect(ack.ok).toBe(true);
    const nonce = (ack.data as { nonce: string }).nonce;
    const message = commandMessage({
      keyId,
      daemonId,
      command: "roots.add",
      nonce,
      payloadHash: createHash("sha256").update(commandDigest(signed)).digest("hex"),
    });
    const signature = sign("sha256", Buffer.from(message), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64");
    return { keyId, nonce, signature };
  };
  const folder = () => realpathSync.native(tempDir("fd-root-"));
  return { client, prove, roots, folder, rootOf: ctx.root };
}

const failure = (ack: Record<string, unknown>) =>
  ack.ok === false ? JSON.stringify((ack as { error?: unknown }).error) : "";

describe("command-proof-roots: adding an allowed folder with a device enrolled takes its signed proof (#3507)", () => {
  test("with a device enrolled, a folder without a proof is refused and the list does not grow", async () => {
    const t = await host();
    const dir = t.folder();
    const ack = await t.client.request("roots.add", { path: dir, confirm: true });
    expect([failure(ack).includes("approval_proof_required"), t.roots.includes(dir)]).toEqual([
      true,
      false,
    ]);
  });

  test("with a device enrolled, the folder signed for this payload is added", async () => {
    const t = await host();
    const dir = t.folder();
    const signed = { path: dir, confirm: true };
    const proof = await t.prove(signed);
    const ack = await t.client.request("roots.add", { ...signed, proof });
    expect([ack.ok, t.roots.includes(dir)]).toEqual([true, true]);
  });

  test("a proof for one folder does not add another", async () => {
    const t = await host();
    const [signedDir, otherDir] = [t.folder(), t.folder()];
    const proof = await t.prove({ path: signedDir, confirm: true });
    const ack = await t.client.request("roots.add", { path: otherDir, confirm: true, proof });
    expect([failure(ack).includes("approval_proof_required"), t.roots.includes(otherDir)]).toEqual([
      true,
      false,
    ]);
  });

  test("a proof is used once: the same one does not add a second folder or the same folder again", async () => {
    const t = await host();
    const dir = t.folder();
    const signed = { path: dir, confirm: true };
    const proof = await t.prove(signed);
    await t.client.request("roots.add", { ...signed, proof });
    const again = await t.client.request("roots.add", { ...signed, proof });
    expect(failure(again).includes("approval_proof_required")).toBe(true);
  });

  test("a confirm that is missing is refused as before, and the challenge it holds is not used up", async () => {
    const t = await host();
    const dir = t.folder();
    const signed = { path: dir, confirm: true };
    const proof = await t.prove(signed);
    const first = await t.client.request("roots.add", { path: dir, proof });
    const second = await t.client.request("roots.add", { ...signed, proof });
    expect([failure(first).includes("root_confirm"), second.ok, t.roots.includes(dir)]).toEqual([
      true,
      true,
      true,
    ]);
  });

  test("a folder that does not exist is refused for what it is, and the challenge is not used up", async () => {
    const t = await host();
    const dir = t.folder();
    const missing = join(dir, "not-there");
    const proof = await t.prove({ path: missing, confirm: true });
    const gone = await t.client.request("roots.add", { path: missing, confirm: true, proof });
    expect(failure(gone).includes("root_missing")).toBe(true);
    mkdirSync(missing);
    const later = await t.client.request("roots.add", { path: missing, confirm: true, proof });
    expect([later.ok, t.roots.includes(realpathSync.native(missing))]).toEqual([true, true]);
  });

  test("a link signed as one folder that leads to another is refused, naming the folder it is", async () => {
    const t = await host();
    const target = t.folder();
    const link = join(t.folder(), "link");
    symlinkSync(target, link);
    const signed = { path: link, confirm: true };
    const proof = await t.prove(signed);
    const ack = await t.client.request("roots.add", { ...signed, proof });
    expect([
      failure(ack).includes("root_path_differs"),
      failure(ack).includes(target),
      t.roots.includes(target),
    ]).toEqual([true, true, false]);
  });

  test("with no device enrolled, a folder with confirm is added as before and carries no proof", async () => {
    const t = await host({ enrolled: false });
    const dir = t.folder();
    const ack = await t.client.request("roots.add", { path: dir, confirm: true });
    expect([ack.ok, t.roots.includes(dir)]).toEqual([true, true]);
  });

  test("the host announces the roots proof", async () => {
    const t = await host();
    const info = await t.client.data<{ features?: string[] }>("host.info", {});
    expect(info?.features).toContain(FEATURE_APPROVAL_ROOTS);
  });
});
