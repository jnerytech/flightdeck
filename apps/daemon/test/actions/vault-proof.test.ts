import { afterEach, describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { enrollFirstMessage, vaultApproveMessage } from "@flightdeck/protocol";
import { Approvers } from "../../src/permissions/approvers.ts";
import { sha256Hex } from "../../src/permissions/domain/approval-gate.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { allow, echoDef, runCleanups, setup } from "../support/rules-approval.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) fn();
  await runCleanups();
});

const ASKER = { connection: 1, address: "100.64.0.7", client: "flightdeck-app" };

/** A device with a P-256 key, as the person's phone or laptop has. */
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

/** The actions service with a host that has (or has no) enrolled device, and the nonces on a clock the test moves. */
async function host(options: { enrolled: boolean; tags?: string[]; ask?: boolean }) {
  const store = new EventStore(":memory:");
  cleanups.push(() => store.close());
  const clock = { wall: Date.parse("2026-11-20T12:00:00.000Z"), mono: 5_000 };
  let n = 0;
  const approvers = new Approvers(store.db, {
    now: () => new Date(clock.wall),
    mono: () => clock.mono,
    random: () => `rnd-${++n}-${"x".repeat(32)}`,
  });
  const dev = device();
  if (options.enrolled) {
    approvers.store.openWindow(sha256Hex("code"), new Date(clock.wall + 600_000));
    const { nonce, daemonId } = approvers.challenge("enroll", undefined, 1);
    const message = enrollFirstMessage({
      daemonId,
      nonce,
      publicKey: dev.pub,
      codeHash: sha256Hex("code"),
    });
    approvers.enroll(
      { publicKey: dev.pub, name: "Phone", nonce, signature: dev.signText(message), code: "code" },
      ASKER,
    );
  }
  const t = setup({ approval: approvers.gate });
  await t.actions.save({
    projectId: "p1",
    definition: echoDef({ tags: options.tags ?? ["producao"] }),
  });
  t.setRules([allow(options.ask ? { decision: "ask" } : {})]);
  /** The proof the device makes: a challenge for `requestId`, signed for `scope` over `signedFor`. */
  const proofFor = (
    requestId: string,
    scope: "once" | "session" = "once",
    signedFor: string = requestId,
  ) => {
    const { nonce, daemonId } = approvers.challenge("approve", requestId, 1);
    const message = vaultApproveMessage({
      keyId: dev.keyId,
      daemonId,
      requestId: signedFor,
      nonce,
      scope,
    });
    return { keyId: dev.keyId, nonce, signature: dev.signText(message) };
  };
  return { ...t, approvers, clock, proofFor };
}

const reasonOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { reason?: string }).reason ?? "no reason";
  }
  return "approved";
};

describe("vault-proof: a prod or high-risk use is approved by a device's signature, not by what the caller says (#3452)", () => {
  test("Given an enrolled device, When a caller sends via app, a 2 s hold and no proof, Then it is refused and the secret is not delivered", async () => {
    const t = await host({ enrolled: true });
    const running = t.run();
    const frame = await t.frame();
    expect(frame).toMatchObject({ decision: "ask", needsHold: true });
    expect(reasonOf(() => t.actions.approve(frame.requestId, { via: "app", heldMs: 2000 }))).toBe(
      "approval_proof_required",
    );
    expect(reasonOf(() => t.actions.gate(frame.purpose))).toBe("action_needs_approval");
    t.actions.deny(frame.requestId);
    await running.catch(() => {});
  });

  test("Given an enrolled device, When the proof signs this request and scope, Then it is approved with no hold", async () => {
    const t = await host({ enrolled: true });
    const running = t.run();
    const frame = await t.frame();
    const proof = t.proofFor(frame.requestId);
    expect(
      reasonOf(() => t.actions.approve(frame.requestId, { via: "app", scope: "once", proof })),
    ).toBe("approved");
    expect(reasonOf(() => t.actions.gate(frame.purpose))).toBe("approved");
    t.deliver(frame);
    expect((await running).output).toContain("•••");
  });

  test("Given a proof made for request A, When it is sent for request B, Then B refuses it and A is still open", async () => {
    const t = await host({ enrolled: true });
    const first = t.run();
    const a = await t.frame(0);
    const second = t.run({ session: "s2" });
    const b = await t.frame(1);
    const forA = t.proofFor(a.requestId);
    expect(reasonOf(() => t.actions.approve(b.requestId, { via: "app", proof: forA }))).toBe(
      "approval_proof_required",
    );
    // The signature of A's own text, with a nonce issued for B: the nonce is B's, the signed request is A's.
    const forBNonceAText = t.proofFor(b.requestId, "once", a.requestId);
    expect(
      reasonOf(() => t.actions.approve(b.requestId, { via: "app", proof: forBNonceAText })),
    ).toBe("approval_proof_required");
    expect(
      reasonOf(() =>
        t.actions.approve(a.requestId, { via: "app", proof: t.proofFor(a.requestId) }),
      ),
    ).toBe("approved");
    t.actions.deny(a.requestId);
    t.actions.deny(b.requestId);
    await first.catch(() => {});
    await second.catch(() => {});
  });

  test("Given a proof already used, When it is sent again, Then it is refused", async () => {
    const t = await host({ enrolled: true });
    const running = t.run();
    const frame = await t.frame();
    const proof = t.proofFor(frame.requestId);
    expect(reasonOf(() => t.actions.approve(frame.requestId, { via: "app", proof }))).toBe(
      "approved",
    );
    expect(reasonOf(() => t.actions.approve(frame.requestId, { via: "app", proof }))).toBe(
      "approval_proof_required",
    );
    t.actions.deny(frame.requestId);
    await running.catch(() => {});
  });

  test("Given a proof past the 60 s of its challenge, Then it is refused as expired", async () => {
    const t = await host({ enrolled: true });
    const running = t.run();
    const frame = await t.frame();
    const proof = t.proofFor(frame.requestId);
    t.clock.mono += 61_000;
    expect(reasonOf(() => t.actions.approve(frame.requestId, { via: "app", proof }))).toBe(
      "approval_challenge_expired",
    );
    t.actions.deny(frame.requestId);
    await running.catch(() => {});
  });

  test("Given a proof that signs the session scope, When the payload asks once, Then it is refused: the scope is signed", async () => {
    const t = await host({ enrolled: true });
    const running = t.run();
    const frame = await t.frame();
    const proof = t.proofFor(frame.requestId, "session");
    expect(
      reasonOf(() => t.actions.approve(frame.requestId, { via: "app", scope: "once", proof })),
    ).toBe("approval_proof_required");
    t.actions.deny(frame.requestId);
    await running.catch(() => {});
  });

  test("Given a request that needs no hold, When an enrolled host gets via app and no proof, Then it is approved as before", async () => {
    const t = await host({ enrolled: true, tags: [], ask: true });
    const running = t.run();
    const frame = await t.frame();
    expect(frame).toMatchObject({ decision: "ask", needsHold: false });
    expect(reasonOf(() => t.actions.approve(frame.requestId, { via: "app" }))).toBe("approved");
    t.deliver(frame);
    await running;
  });

  test("Given no enrolled device, Then the 2 s hold still approves and a shorter one still does not", async () => {
    const t = await host({ enrolled: false });
    const running = t.run();
    const frame = await t.frame();
    expect(reasonOf(() => t.actions.approve(frame.requestId, { via: "app", heldMs: 500 }))).toBe(
      "action_hold_needed",
    );
    expect(reasonOf(() => t.actions.approve(frame.requestId, { via: "app", heldMs: 2000 }))).toBe(
      "approved",
    );
    t.deliver(frame);
    await running;
  });
});
