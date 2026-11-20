import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { commandDigest, commandMessage, FEATURE_APPROVAL_BYPASS } from "@flightdeck/protocol";
import { Approvers } from "../../src/permissions/approvers.ts";
import { keyIdOf } from "../../src/permissions/domain/approval-gate.ts";
import { startServer } from "../../src/server.ts";
import { newManager } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * Issue #3507: with a device enrolled, turning bypass on (`host.bypass { allow: true }`) runs only with the
 * signed proof of that device over the payload; turning it off stays open, and with no device nothing changes.
 */
const TOKEN = "bypass-proof-token-0123456789abcdef";

async function host(options: { enrolled?: boolean; allowed?: boolean } = {}) {
  const ctx = newManager();
  let allowed = options.allowed ?? false;
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
    sessionSettings: {
      bypass: {
        allowed: () => allowed,
        set: (allow: boolean) => {
          allowed = allow;
        },
      },
    },
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [ctx.root],
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "flightdeck-app" });
  const daemonId = approvers.list().daemonId;
  /** The proof of the device over `host.bypass` and `signed`, with a nonce asked of the host. */
  const prove = async (signed: Record<string, unknown>) => {
    const ack = await client.request("approval.challenge", {
      purpose: "command",
      command: "host.bypass",
    });
    expect(ack.ok).toBe(true);
    const nonce = (ack.data as { nonce: string }).nonce;
    const message = commandMessage({
      keyId,
      daemonId,
      command: "host.bypass",
      nonce,
      payloadHash: createHash("sha256").update(commandDigest(signed)).digest("hex"),
    });
    const signature = sign("sha256", Buffer.from(message), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64");
    return { keyId, nonce, signature };
  };
  return { client, prove, allowed: () => allowed };
}

const failure = (ack: Record<string, unknown>) =>
  ack.ok === false ? JSON.stringify((ack as { error?: unknown }).error) : "";
const ON = { allow: true, confirm: true };

describe("command-proof-bypass: turning bypass on with a device enrolled takes its signed proof (#3507)", () => {
  test("with a device enrolled, allow true without a proof is refused and the switch stays off", async () => {
    const t = await host();
    const ack = await t.client.request("host.bypass", ON);
    expect([failure(ack).includes("approval_proof_required"), t.allowed()]).toEqual([true, false]);
  });

  test("with a device enrolled, allow true signed for this payload turns the switch on", async () => {
    const t = await host();
    const proof = await t.prove(ON);
    const ack = await t.client.request("host.bypass", { ...ON, proof });
    expect([ack.ok, t.allowed()]).toEqual([true, true]);
  });

  test("a proof is used once: the same one does not turn the switch on a second time", async () => {
    const t = await host();
    const proof = await t.prove(ON);
    await t.client.request("host.bypass", { ...ON, proof });
    await t.client.request("host.bypass", { allow: false });
    const again = await t.client.request("host.bypass", { ...ON, proof });
    expect([failure(again).includes("approval_proof_required"), t.allowed()]).toEqual([
      true,
      false,
    ]);
  });

  test("with a device enrolled, allow false needs no proof: turning off stays open", async () => {
    const t = await host({ allowed: true });
    const ack = await t.client.request("host.bypass", { allow: false });
    expect([ack.ok, t.allowed()]).toEqual([true, false]);
  });

  test("an allow not confirmed is refused as before, and the challenge it holds is not used up", async () => {
    const t = await host();
    const proof = await t.prove({ allow: true });
    const first = await t.client.request("host.bypass", { allow: true, proof });
    const second = await t.client.request("host.bypass", { ...ON, proof });
    expect([
      failure(first).includes("bypass_confirm"),
      failure(second).includes("approval_proof_required"),
    ]).toEqual([true, true]);
  });

  test("with no device enrolled, allow true runs as before and carries no proof", async () => {
    const t = await host({ enrolled: false });
    const ack = await t.client.request("host.bypass", ON);
    expect([ack.ok, t.allowed()]).toEqual([true, true]);
  });

  test("the host announces the bypass proof", async () => {
    const t = await host();
    const info = await t.client.data<{ features?: string[] }>("host.info", {});
    expect(info?.features).toContain(FEATURE_APPROVAL_BYPASS);
  });
});
