import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { commandDigest, commandMessage, FEATURE_APPROVAL_RESUME } from "@flightdeck/protocol";
import { Approvers } from "../../src/permissions/approvers.ts";
import { keyIdOf } from "../../src/permissions/domain/approval-gate.ts";
import { type RunningServer, startServer } from "../../src/server.ts";
import { newManager } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { cleanups, setup, teardown } from "./auto-approve-setup.ts";

setDefaultTimeout(30_000);

/**
 * Issue #3453: with a device enrolled, `autoapprove.resume` runs only with the signed proof of that
 * device over the session it resumes; with none enrolled it is as before.
 */
const TOKEN = "resume-proof-token-0123456789abcdef";
const SESSION = "card:c1";
const servers: RunningServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
  await teardown();
});

async function host(options: { enrolled?: boolean } = {}) {
  const { manager, root, store } = newManager();
  const { auto } = setup();
  auto.suspend(SESSION, "third-party content");
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
  const server = startServer({
    manager,
    approvers,
    autoApprove: auto,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [root],
  } as Parameters<typeof startServer>[0]);
  servers.push(server);
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "flightdeck-app" });
  const daemonId = approvers.list().daemonId;
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
  const suspended = () => auto.suspended().map((s) => s.sessionKey);
  return { client, prove, suspended };
}

const failure = (ack: Record<string, unknown>) =>
  ack.ok === false ? JSON.stringify((ack as { error?: unknown }).error) : "";

describe("resume-proof: resuming the automatic approver with a device enrolled takes its proof (#3453)", () => {
  test("without a proof it is refused and the session stays suspended", async () => {
    const t = await host();
    const ack = await t.client.request("autoapprove.resume", {
      sessionKey: SESSION,
      confirm: true,
    });
    expect([failure(ack).includes("approval_proof_required"), t.suspended()]).toEqual([
      true,
      [SESSION],
    ]);
  });

  test("with a proof over this session it resumes", async () => {
    const t = await host();
    const payload = { sessionKey: SESSION, confirm: true };
    const proof = await t.prove("autoapprove.resume", payload);
    const ack = await t.client.request("autoapprove.resume", { ...payload, proof });
    expect([ack.ok, t.suspended()]).toEqual([true, []]);
  });

  test("a proof signed for another session does not resume this one", async () => {
    const t = await host();
    const proof = await t.prove("autoapprove.resume", { sessionKey: "card:c2", confirm: true });
    const ack = await t.client.request("autoapprove.resume", {
      sessionKey: SESSION,
      confirm: true,
      proof,
    });
    expect([failure(ack).includes("approval_proof_required"), t.suspended()]).toEqual([
      true,
      [SESSION],
    ]);
  });

  test("a resume with no confirm is refused for it and burns no nonce", async () => {
    const t = await host();
    const ack = await t.client.request("autoapprove.resume", { sessionKey: SESSION });
    expect([failure(ack).includes("autoapprove_resume_confirm"), t.suspended()]).toEqual([
      true,
      [SESSION],
    ]);
  });

  test("with no device enrolled it resumes as before", async () => {
    const t = await host({ enrolled: false });
    const ack = await t.client.request("autoapprove.resume", {
      sessionKey: SESSION,
      confirm: true,
    });
    expect([ack.ok, t.suspended()]).toEqual([true, []]);
  });

  test("the host announces the resume proof", async () => {
    const t = await host();
    const info = await t.client.data<{ features?: string[] }>("host.info", {});
    expect(info?.features).toContain(FEATURE_APPROVAL_RESUME);
  });
});
