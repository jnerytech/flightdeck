import { afterEach, describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import {
  approvalDigests,
  approvalMessage,
  enrollAddMessage,
  enrollFirstMessage,
  FEATURE_APPROVAL_PROOF,
  revokeMessage,
} from "@flightdeck/protocol";
import type { Central } from "../../src/central/central.ts";
import { ExternalSessions } from "../../src/central/external.ts";
import { ExternalPermissions } from "../../src/central/external-permissions.ts";
import { startReceptor } from "../../src/central/receptor.ts";
import { SessionMetaStore } from "../../src/central/session-meta.ts";
import { Approvers } from "../../src/permissions/approvers.ts";
import { sha256Hex } from "../../src/permissions/domain/approval-gate.ts";
import { RiskClassifier } from "../../src/permissions/domain/risk.ts";
import { startServer } from "../../src/server.ts";
import { newManager, poll } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

const TOKEN = "app-token-0123456789abcdef";
const HOOKS = "hooks-token-0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function device() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spki = publicKey.export({ type: "spki", format: "der" });
  return {
    pub: spki.toString("base64"),
    keyId: createHash("sha256").update(spki).digest("hex"),
    signText: (text: string) =>
      sign("sha256", Buffer.from(text), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString(
        "base64",
      ),
  };
}

/** A daemon with approvers (or without), the hook receptor of an external session, and a client that said hello. */
async function setup(withApprovers = true) {
  const { manager, store } = newManager();
  const approvers = new Approvers(store.db, {
    now: () => new Date(),
    mono: () => performance.now(),
    random: () => randomBytes(24).toString("base64url"),
  });
  const risk = new RiskClassifier({ allowedRoots: ["/p"], home: "/home/u" });
  const external = new ExternalSessions({ db: store.db, staleAfterS: 900 });
  const permissions = new ExternalPermissions({ risk, approval: approvers.gate });
  const receptor = startReceptor({
    port: 0,
    token: () => HOOKS,
    external,
    permissions,
    isManaged: () => false,
  });
  cleanups.push(() => receptor.stop());
  const server = startServer({
    manager,
    central: { external, permissions, meta: new SessionMetaStore(store.db) } as unknown as Central,
    ...(withApprovers ? { approvers } : {}),
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "flightdeck-app" });
  await client.request("external.watch", {});
  const post = (event: string, body: Record<string, unknown>) =>
    fetch(`${receptor.url}/hooks/${event}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${HOOKS}`, "content-type": "application/json" },
      body: JSON.stringify({ session_id: "s1", hook_event_name: event, ...body }),
    }).then(async (r) => r.text());
  /** A held `rm -rf` hook: its request id and the answer the hook will get. */
  const hold = async () => {
    await post("SessionStart", { cwd: "/p" });
    const answer = post("PermissionRequest", {
      tool_name: "Bash",
      tool_input: { command: "rm -rf build" },
      permission_suggestions: [],
    });
    // A hook left held when the test ends loses its socket: that is no failure of the test.
    answer.catch(() => {});
    const open = await poll(() =>
      client.frames.find(
        (f) => f.type === "external.permission" && (f as { state?: string }).state === "open",
      ),
    );
    return { requestId: (open as { requestId: string }).requestId, answer };
  };
  const challenge = async (payload: Record<string, unknown>) => {
    const ack = await client.request("approval.challenge", payload);
    return ack.data as { nonce: string; daemonId: string; expiresInMs: number };
  };
  /** Opens the window as the host terminal does (on the store), and enrolls `dev` over the wire. */
  const enrollFirst = async (dev: ReturnType<typeof device>, code = "the-code") => {
    approvers.store.openWindow(sha256Hex(code), new Date(Date.now() + 600_000));
    const { nonce, daemonId } = await challenge({ purpose: "enroll" });
    const message = enrollFirstMessage({
      daemonId,
      nonce,
      publicKey: dev.pub,
      codeHash: sha256Hex(code),
    });
    return await client.request("approval.enroll", {
      publicKey: dev.pub,
      name: "phone",
      nonce,
      signature: dev.signText(message),
      code,
    });
  };
  return {
    approvers,
    client,
    hold,
    challenge,
    enrollFirst,
    permissions,
    server,
  };
}

const refusal = (ack: Record<string, unknown>) =>
  ack.ok === false ? JSON.stringify((ack as { error?: unknown }).error) : "";

describe("approval-handlers: a host without approvers", () => {
  test("Given no approvers, Then every approval command is feature_off and host.info announces nothing", async () => {
    const { client } = await setup(false);
    for (const [type, payload] of [
      ["approval.list", {}],
      ["approval.challenge", { purpose: "enroll" }],
    ] as const) {
      const ack = await client.request(type, payload);
      expect(ack.ok).toBe(false);
      expect(refusal(ack)).toContain("feature_off");
    }
    const info = await client.data<{ features?: string[]; daemonId?: string }>("host.info", {});
    expect(info?.features).not.toContain(FEATURE_APPROVAL_PROOF);
    expect(info?.daemonId).toBeUndefined();
  });
});

describe("approval-handlers: the commands over the wire", () => {
  test("Given approvers, Then host.info announces the feature and the daemon id, and the list says protection is off", async () => {
    const { client, approvers } = await setup();
    const info = await client.data<{ features?: string[]; daemonId?: string }>("host.info", {});
    expect(info?.features).toContain(FEATURE_APPROVAL_PROOF);
    expect(info?.daemonId).toBe(approvers.daemonId());
    const list = await client.data<{ protectionOff: boolean; keys: unknown[] }>(
      "approval.list",
      {},
    );
    expect(list).toMatchObject({ protectionOff: true, keys: [] });
  });

  test("Given an open request, Then a challenge gives a nonce; for a request that is not open it is refused", async () => {
    const { client, hold, challenge } = await setup();
    const { requestId } = await hold();
    const got = await challenge({ purpose: "approve", requestId });
    expect(got.nonce.length).toBeGreaterThan(0);
    expect(got.expiresInMs).toBe(60_000);
    const closed = await client.request("approval.challenge", {
      purpose: "approve",
      requestId: "ext-none",
    });
    expect(refusal(closed)).toContain("permission_request_closed");
  });

  test("Given no window, When a device enrolls, Then it is refused, no key is stored and the refusal echoes neither nonce nor key", async () => {
    const { approvers, client, challenge } = await setup();
    const dev = device();
    const { nonce, daemonId } = await challenge({ purpose: "enroll" });
    const ack = await client.request("approval.enroll", {
      publicKey: dev.pub,
      name: "phone",
      nonce,
      signature: dev.signText(
        enrollFirstMessage({ daemonId, nonce, publicKey: dev.pub, codeHash: sha256Hex("c") }),
      ),
      code: "c",
    });
    expect(refusal(ack)).toContain("approval_enroll_closed");
    expect(refusal(ack)).not.toContain(nonce);
    expect(refusal(ack)).not.toContain(dev.pub);
    expect(approvers.keys()).toEqual([]);
  });

  test("Given a window the terminal opened, When a device enrolls, Then it is listed with the name the client said hello with", async () => {
    const { client, enrollFirst } = await setup();
    const dev = device();
    const ack = await enrollFirst(dev);
    expect(ack.ok).toBe(true);
    expect((ack.data as { keyId: string }).keyId).toBe(dev.keyId);
    const list = await client.data<{
      protectionOff: boolean;
      keys: Array<{ keyId: string; client: string; name: string }>;
    }>("approval.list", {});
    expect(list?.protectionOff).toBe(false);
    expect(list?.keys.map((k) => [k.keyId, k.client, k.name])).toEqual([
      [dev.keyId, "flightdeck-app", "phone"],
    ]);
  });

  test("Given a key, When a second key is added and one is revoked over the wire, Then the last key stays", async () => {
    const { client, enrollFirst, challenge, approvers } = await setup();
    const phone = device();
    const laptop = device();
    await enrollFirst(phone);
    const add = await challenge({ purpose: "enroll" });
    const added = await client.request("approval.enroll", {
      publicKey: laptop.pub,
      name: "laptop",
      nonce: add.nonce,
      signerKeyId: phone.keyId,
      signature: phone.signText(
        enrollAddMessage({
          keyId: phone.keyId,
          daemonId: add.daemonId,
          nonce: add.nonce,
          newPublicKey: laptop.pub,
        }),
      ),
    });
    expect(added.ok).toBe(true);
    const revokeOf = async (signer: ReturnType<typeof device>, target: string) => {
      const rv = await challenge({ purpose: "revoke" });
      return await client.request("approval.revoke", {
        targetKeyId: target,
        signerKeyId: signer.keyId,
        nonce: rv.nonce,
        signature: signer.signText(
          revokeMessage({
            keyId: signer.keyId,
            daemonId: rv.daemonId,
            nonce: rv.nonce,
            targetKeyId: target,
          }),
        ),
      });
    };
    expect((await revokeOf(laptop, phone.keyId)).ok).toBe(true);
    expect(refusal(await revokeOf(laptop, laptop.keyId))).toContain("approval_last_key");
    expect(approvers.keys().map((k) => k.keyId)).toEqual([laptop.keyId]);
  });

  test("Given a payload with a field that would open the window or reset, Then it is refused and the store is unchanged", async () => {
    const { client, approvers, challenge } = await setup();
    const { nonce } = await challenge({ purpose: "enroll" });
    const hostile = {
      publicKey: "p",
      name: "x",
      nonce,
      signature: "s",
      openWindow: true,
      windowMinutes: 60,
      codeHash: "h",
      reset: true,
    };
    expect((await client.request("approval.enroll", hostile)).ok).toBe(false);
    expect((await client.request("approval.revoke", { ...hostile, targetKeyId: "t" })).ok).toBe(
      false,
    );
    expect((await client.request("approval.list", { reset: true })).ok).toBe(false);
    expect((await client.request("approval.reset", {})).ok).toBe(false);
    expect((await client.request("approval.open", {})).ok).toBe(false);
    expect(approvers.store.window()).toBeNull();
    expect(approvers.keys()).toEqual([]);
  });
});

describe("approval-handlers: a high-risk allow of an external session, end to end", () => {
  test("Given an enrolled key, When the allow carries only the hold, Then it is refused; with the signed proof it passes", async () => {
    const { client, hold, challenge, enrollFirst } = await setup();
    const dev = device();
    await enrollFirst(dev);
    const { requestId, answer } = await hold();
    const held = await client.request("permission.respond", {
      requestId,
      decision: "allow",
      held: true,
    });
    expect(refusal(held)).toContain("approval_proof_required");
    const { nonce, daemonId } = await challenge({ purpose: "approve", requestId });
    const digests = approvalDigests({});
    const message = approvalMessage({
      keyId: dev.keyId,
      daemonId,
      requestId,
      nonce,
      permissionsHash: sha256Hex(digests.permissions),
      inputHash: sha256Hex(digests.input),
      messageHash: sha256Hex(digests.message),
    });
    const ok = await client.request("permission.respond", {
      requestId,
      decision: "allow",
      proof: { keyId: dev.keyId, nonce, signature: dev.signText(message) },
    });
    expect(ok.ok).toBe(true);
    expect(JSON.parse(await answer).hookSpecificOutput.decision.behavior).toBe("allow");
  });
});
