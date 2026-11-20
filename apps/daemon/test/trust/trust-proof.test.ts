import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import {
  commandDigest,
  commandMessage,
  FEATURE_APPROVAL_TRUST,
  type ProjectTrustState,
} from "@flightdeck/protocol";
import { Approvers } from "../../src/permissions/approvers.ts";
import { keyIdOf } from "../../src/permissions/domain/approval-gate.ts";
import { type RunningServer, startServer } from "../../src/server.ts";
import { newManager } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

setDefaultTimeout(30_000);

/**
 * Issue #3453: with a device enrolled, `project.trust.set` with `trusted: true` runs only with the signed
 * proof of that device over the folder the daemon trusts; revoking trust stays open.
 */
const TOKEN = "trust-proof-token-0123456789abcdef";
const servers: RunningServer[] = [];
const closers: Array<() => unknown> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  for (const server of servers.splice(0)) await server.stop();
});

async function host(options: { enrolled?: boolean } = {}) {
  const { manager, root, project, store } = newManager();
  let n = 0;
  const approvers = new Approvers(store.db, {
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
  const decided: Array<[string, boolean]> = [];
  const state = (path: string, trusted: boolean): ProjectTrustState => ({
    path,
    trusted,
    via: trusted ? path : null,
  });
  const server = startServer({
    manager,
    approvers,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [root],
    projects: {
      trust: {
        refresh: async () => undefined,
        state: (paths) => paths.map((p) => state(p, false)),
        inspect: async () => ({}) as never,
        set: (path, trusted) => {
          decided.push([path, trusted]);
          return state(path, trusted);
        },
      },
    },
  } as Parameters<typeof startServer>[0]);
  servers.push(server);
  const client = new FrameClient(server.url);
  closers.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "flightdeck-app" });
  const daemonId = approvers.list().daemonId;
  /** The proof of the device over `command` and `signed`, with a nonce asked of the host. */
  const prove = async (command: string, signed: Record<string, unknown>) => {
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
  return { client, root, project, decided, prove };
}

const failure = (ack: Record<string, unknown>) =>
  ack.ok === false ? JSON.stringify((ack as { error?: unknown }).error) : "";

describe("trust-proof: trusting a folder with a device enrolled takes its signed proof (#3453)", () => {
  test("with a device enrolled, trusting without a proof is refused and nothing is trusted", async () => {
    const t = await host();
    const ack = await t.client.request("project.trust.set", { path: t.project, trusted: true });
    expect([failure(ack).includes("approval_proof_required"), t.decided]).toEqual([true, []]);
  });

  test("with a device enrolled, trusting with a proof over this folder trusts it", async () => {
    const t = await host();
    const payload = { path: t.project, trusted: true };
    const proof = await t.prove("project.trust.set", payload);
    const ack = await t.client.request("project.trust.set", { ...payload, proof });
    expect([ack.ok, t.decided]).toEqual([true, [[t.project, true]]]);
  });

  test("a proof signed for another folder does not trust this one", async () => {
    const t = await host();
    const proof = await t.prove("project.trust.set", {
      path: join(t.root, "other"),
      trusted: true,
    });
    const ack = await t.client.request("project.trust.set", {
      path: t.project,
      trusted: true,
      proof,
    });
    expect([failure(ack).includes("approval_proof_required"), t.decided]).toEqual([true, []]);
  });

  test("revoking trust takes no proof, even with a device enrolled", async () => {
    const t = await host();
    const ack = await t.client.request("project.trust.set", { path: t.project, trusted: false });
    expect([ack.ok, t.decided]).toEqual([true, [[t.project, false]]]);
  });

  test("a folder named through a link is refused with the folder it is, and nothing is trusted", async () => {
    const t = await host();
    const link = join(t.root, "link-to-project");
    symlinkSync(t.project, link);
    const payload = { path: link, trusted: true };
    const proof = await t.prove("project.trust.set", payload);
    const ack = await t.client.request("project.trust.set", { ...payload, proof });
    const error = (ack.error ?? {}) as { reason?: string; params?: { path?: string } };
    expect([error.reason, error.params?.path, t.decided]).toEqual([
      "trust_path_differs",
      t.project,
      [],
    ]);
  });

  test("with no device enrolled, trusting runs as before, through a link too", async () => {
    const t = await host({ enrolled: false });
    const link = join(t.root, "link-to-project");
    symlinkSync(t.project, link);
    const ack = await t.client.request("project.trust.set", { path: link, trusted: true });
    expect([ack.ok, t.decided]).toEqual([true, [[t.project, true]]]);
  });

  test("the host announces the trust proof", async () => {
    const t = await host();
    const info = await t.client.data<{ features?: string[] }>("host.info", {});
    expect(info?.features).toContain(FEATURE_APPROVAL_TRUST);
  });
});
