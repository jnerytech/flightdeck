import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { commandDigest, commandMessage } from "@flightdeck/protocol";
import { Actions } from "../../src/actions/actions.ts";
import { Approvers } from "../../src/permissions/approvers.ts";
import { keyIdOf } from "../../src/permissions/domain/approval-gate.ts";
import { startServer } from "../../src/server.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { VaultRules } from "../../src/vault/rules-store.ts";
import { Vault } from "../../src/vault/vault.ts";
import { gitRepo } from "../support/board-helpers.ts";
import { newManager, tempDir } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * Issue #3754: with a device enrolled, a `vault.rules.set` whose rules loosen (a decision or an outsideWindow of
 * `allow`) runs only with the signed proof of that device over the whole request; a set of `ask` and `deny`
 * rules needs none, and with no device nothing changes.
 */
const TOKEN = "vault-rules-proof-token-0123456789";

const ALLOW = {
  id: "r1",
  decision: "allow",
  match: { purpose: "ssh" },
  window: { days: ["mon"], from: "09:00", to: "17:00" },
};
const ASK = { id: "r2", decision: "ask", match: { purpose: "ssh" } };
const DENY = { id: "r3", decision: "deny", match: { purpose: "action" } };
const OUTSIDE_ALLOW = {
  id: "r4",
  decision: "ask",
  outsideWindow: "allow",
  match: { purpose: "ssh" },
  window: { days: ["mon"], from: "09:00", to: "17:00" },
};

function host(options: { enrolled?: boolean } = {}) {
  const ctx = newManager();
  const { repo } = gitRepo();
  const store = new EventStore(":memory:");
  const vault = new Vault({ log: () => {} });
  const actions = new Actions({
    db: store.db,
    vault,
    rules: new VaultRules(),
    hostName: "vps",
    hostBase: tempDir("fd-host-"),
    requestTimeoutMs: 3000,
    projects: () => ({ id: "p1", path: repo, baseBranch: "main" }),
  });
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
    vault,
    actions,
    approvers,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
  });
  cleanups.push(() => {
    void server.stop();
    actions.stop();
    vault.stop();
  });
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  const ready = client.request("hello", { token: TOKEN, client: "flightdeck-app" });
  const daemonId = approvers.list().daemonId;
  /** The proof of the device over `signed`, with a nonce asked of the host. */
  const prove = async (signed: Record<string, unknown>) => {
    await ready;
    const ack = await client.request("approval.challenge", {
      purpose: "command",
      command: "vault.rules.set",
    });
    expect(ack.ok).toBe(true);
    const nonce = (ack.data as { nonce: string }).nonce;
    const message = commandMessage({
      keyId,
      daemonId,
      command: "vault.rules.set",
      nonce,
      payloadHash: createHash("sha256").update(commandDigest(signed)).digest("hex"),
    });
    const signature = sign("sha256", Buffer.from(message), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64");
    return { keyId, nonce, signature };
  };
  const set = async (payload: Record<string, unknown>) => {
    await ready;
    return client.request("vault.rules.set", payload);
  };
  const held = async () => {
    await ready;
    const ack = await client.request("vault.rules.get", { secretId: "token" });
    return (ack.data as { rules: Array<{ id: string }> }).rules.map((rule) => rule.id);
  };
  return { set, prove, held };
}

const failure = (ack: Record<string, unknown>) =>
  ack.ok === false ? JSON.stringify((ack as { error?: unknown }).error) : "";

describe("command-proof-vault-rules: loosening a secret's rules with a device enrolled takes its signed proof (#3754)", () => {
  test("a rule that allows, with no proof, is refused and the rules stay as they were", async () => {
    const t = host();
    const ack = await t.set({ secretId: "token", tags: [], rules: [ALLOW] });
    expect([failure(ack).includes("approval_proof_required"), await t.held()]).toEqual([true, []]);
  });

  test("an outsideWindow of allow is a loosening too: with no proof it is refused", async () => {
    const t = host();
    const ack = await t.set({ secretId: "token", tags: [], rules: [OUTSIDE_ALLOW] });
    expect([failure(ack).includes("approval_proof_required"), await t.held()]).toEqual([true, []]);
  });

  test("a rule list that is not a list is gated, never let through as if it loosened nothing", async () => {
    const t = host();
    const ack = await t.set({ secretId: "token", tags: [], rules: "allow" });
    expect(failure(ack).includes("approval_proof_required")).toBe(true);
  });

  test("a loosening hidden after harmless rules is still refused", async () => {
    const t = host();
    const ack = await t.set({ secretId: "token", tags: [], rules: [ASK, DENY, ALLOW] });
    expect([failure(ack).includes("approval_proof_required"), await t.held()]).toEqual([true, []]);
  });

  test("a proof signed for these rules saves them", async () => {
    const t = host();
    const signed = { secretId: "token", tags: [], rules: [ALLOW] };
    const ack = await t.set({ ...signed, proof: await t.prove(signed) });
    expect([ack.ok, await t.held()]).toEqual([true, ["r1"]]);
  });

  test("a proof covers the rules: one signed for a tighter set does not save a looser one", async () => {
    const t = host();
    const proof = await t.prove({ secretId: "token", tags: [], rules: [ASK] });
    const ack = await t.set({ secretId: "token", tags: [], rules: [ALLOW], proof });
    expect([failure(ack).includes("approval_proof_required"), await t.held()]).toEqual([true, []]);
  });

  test("a proof covers the secret: one signed for another secret does not save these rules", async () => {
    const t = host();
    const proof = await t.prove({ secretId: "other", tags: [], rules: [ALLOW] });
    const ack = await t.set({ secretId: "token", tags: [], rules: [ALLOW], proof });
    expect([failure(ack).includes("approval_proof_required"), await t.held()]).toEqual([true, []]);
  });

  test("a proof covers the tags: one signed without the prod tag does not save the rules of a prod secret", async () => {
    const t = host();
    const proof = await t.prove({ secretId: "token", tags: [], rules: [ALLOW] });
    const ack = await t.set({ secretId: "token", tags: ["prod"], rules: [ALLOW], proof });
    expect([failure(ack).includes("approval_proof_required"), await t.held()]).toEqual([true, []]);
  });

  test("a proof is spent once: the same signed set cannot run twice", async () => {
    const t = host();
    const signed = { secretId: "token", tags: [], rules: [ALLOW] };
    const proof = await t.prove(signed);
    const first = await t.set({ ...signed, proof });
    const second = await t.set({ ...signed, proof });
    expect([first.ok, failure(second).includes("approval_proof")]).toEqual([true, true]);
  });

  test("a set of ask and deny rules needs no proof, so tightening is never held up", async () => {
    const t = host();
    const ack = await t.set({ secretId: "token", tags: [], rules: [ASK, DENY] });
    expect([ack.ok, await t.held()]).toEqual([true, ["r2", "r3"]]);
  });

  test("an empty set needs no proof: the person can always clear the rules", async () => {
    const t = host();
    const ack = await t.set({ secretId: "token", tags: [], rules: [] });
    expect(ack.ok).toBe(true);
  });

  test("with no device enrolled nothing changes: a rule that allows is saved with no proof", async () => {
    const t = host({ enrolled: false });
    const ack = await t.set({ secretId: "token", tags: [], rules: [ALLOW] });
    expect([ack.ok, await t.held()]).toEqual([true, ["r1"]]);
  });
});
