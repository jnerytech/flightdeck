import { afterEach, describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  type CommandPayload,
  enrollAddMessage,
  enrollFirstMessage,
  revokeMessage,
} from "@flightdeck/protocol";
import { Approvers } from "../../src/permissions/approvers.ts";
import { sha256Hex } from "../../src/permissions/domain/approval-gate.ts";
import { EventStore } from "../../src/store/event-store.ts";

const cleanups: Array<() => unknown> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
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

const ASKER = { connection: 1, address: "100.64.0.7", client: "flightdeck-app" };

function setup() {
  const store = new EventStore(":memory:");
  cleanups.push(() => store.close());
  const clock = { wall: Date.parse("2026-11-20T12:00:00.000Z"), mono: 5_000 };
  let n = 0;
  const approvers = new Approvers(store.db, {
    now: () => new Date(clock.wall),
    mono: () => clock.mono,
    random: () => `rnd-${++n}-${"x".repeat(24)}`,
  });
  const open = (code: string, minutes = 10) =>
    approvers.store.openWindow(sha256Hex(code), new Date(clock.wall + minutes * 60_000));
  const enrollFirst = (dev: ReturnType<typeof device>, code: string, name = "Ana's phone") => {
    const { nonce, daemonId } = approvers.challenge("enroll", undefined, 1);
    const message = enrollFirstMessage({
      daemonId,
      nonce,
      publicKey: dev.pub,
      codeHash: sha256Hex(code),
    });
    const payload: CommandPayload<"approval.enroll"> = {
      publicKey: dev.pub,
      name,
      nonce,
      signature: dev.signText(message),
      code,
    };
    return payload;
  };
  const enrollAdd = (signer: ReturnType<typeof device>, added: ReturnType<typeof device>) => {
    const { nonce, daemonId } = approvers.challenge("enroll", undefined, 1);
    const message = enrollAddMessage({
      keyId: signer.keyId,
      daemonId,
      nonce,
      newPublicKey: added.pub,
    });
    const payload: CommandPayload<"approval.enroll"> = {
      publicKey: added.pub,
      name: "Laptop",
      nonce,
      signature: signer.signText(message),
      signerKeyId: signer.keyId,
    };
    return payload;
  };
  const revokeOf = (signer: ReturnType<typeof device>, target: string) => {
    const { nonce, daemonId } = approvers.challenge("revoke", undefined, 1);
    const message = revokeMessage({ keyId: signer.keyId, daemonId, nonce, targetKeyId: target });
    const payload: CommandPayload<"approval.revoke"> = {
      targetKeyId: target,
      signerKeyId: signer.keyId,
      nonce,
      signature: signer.signText(message),
    };
    return payload;
  };
  return { approvers, store, clock, open, enrollFirst, enrollAdd, revokeOf };
}

const reasonOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { reason?: string }).reason;
  }
  return undefined;
};

describe("approvers: the daemon's id is made once and kept", () => {
  test("Given a daemon, Then its id is long, stable and the same after a restart", () => {
    const { approvers, store } = setup();
    const id = approvers.daemonId();
    expect(id.length).toBeGreaterThanOrEqual(32);
    expect(approvers.daemonId()).toBe(id);
    const again = new Approvers(store.db, {
      now: () => new Date(),
      mono: () => 0,
      random: () => "other-id",
    });
    expect(again.daemonId()).toBe(id);
  });

  test("Given no key, Then the list says protection is off and a challenge names the daemon", () => {
    const { approvers } = setup();
    expect(approvers.list()).toEqual({
      daemonId: approvers.daemonId(),
      protectionOff: true,
      keys: [],
    });
    expect(approvers.keys()).toEqual([]);
    const challenge = approvers.challenge("enroll", undefined, 1);
    expect(challenge.daemonId).toBe(approvers.daemonId());
    expect(challenge.expiresInMs).toBe(60_000);
    expect(challenge.nonce.length).toBeGreaterThan(0);
  });
});

describe("approvers: the first key is enrolled only inside a window the host terminal opened", () => {
  test("Given no window, When a device tries to enroll, Then approval_enroll_closed and no key", () => {
    const { approvers, enrollFirst } = setup();
    expect(reasonOf(() => approvers.enroll(enrollFirst(device(), "code"), ASKER))).toBe(
      "approval_enroll_closed",
    );
    expect(approvers.keys()).toEqual([]);
  });

  test("Given an open window and the right code, Then the device is enrolled and the window closes", () => {
    const { approvers, open, enrollFirst } = setup();
    const phone = device();
    open("the-code");
    const result = approvers.enroll(enrollFirst(phone, "the-code"), ASKER);
    expect(result).toEqual({ keyId: phone.keyId, daemonId: approvers.daemonId() });
    const listed = approvers.list();
    expect(listed.protectionOff).toBe(false);
    expect(listed.keys).toEqual([
      {
        keyId: phone.keyId,
        name: "Ana's phone",
        client: "flightdeck-app",
        address: "100.64.0.7",
        enrolledAt: "2026-11-20T12:00:00.000Z",
      },
    ]);
    expect(approvers.keys()).toEqual([{ keyId: phone.keyId, publicKey: phone.pub }]);
    expect(approvers.store.window()).toBeNull();
  });

  test("Given an enrolled device, When another device uses the code path, Then it is refused: only a key adds a key", () => {
    const { approvers, open, enrollFirst } = setup();
    open("the-code");
    approvers.enroll(enrollFirst(device(), "the-code"), ASKER);
    open("the-code");
    expect(reasonOf(() => approvers.enroll(enrollFirst(device(), "the-code"), ASKER))).toBe(
      "approval_proof_required",
    );
    expect(approvers.keys().length).toBe(1);
  });

  test("Given a window past its ten minutes, Then enrolling is closed", () => {
    const { approvers, open, enrollFirst, clock } = setup();
    open("the-code", 10);
    const payload = enrollFirst(device(), "the-code");
    clock.wall += 10 * 60_000 + 1;
    expect(reasonOf(() => approvers.enroll(payload, ASKER))).toBe("approval_enroll_closed");
  });

  test("Given a wrong code, Then it is refused and the window closes after the fifth failure, even for the right code", () => {
    const { approvers, open, enrollFirst } = setup();
    open("the-code");
    for (let i = 0; i < 5; i++) {
      expect(reasonOf(() => approvers.enroll(enrollFirst(device(), "wrong"), ASKER))).toBe(
        "approval_proof_required",
      );
    }
    expect(approvers.store.window()).toBeNull();
    expect(reasonOf(() => approvers.enroll(enrollFirst(device(), "the-code"), ASKER))).toBe(
      "approval_enroll_closed",
    );
    open("the-code");
    expect(() => approvers.enroll(enrollFirst(device(), "the-code"), ASKER)).not.toThrow();
  });

  test("Given a signature made with another key than the one sent, Then it is refused and no key is stored", () => {
    const { approvers, open, enrollFirst } = setup();
    open("the-code");
    const payload = enrollFirst(device(), "the-code");
    const stranger = device();
    expect(reasonOf(() => approvers.enroll({ ...payload, publicKey: stranger.pub }, ASKER))).toBe(
      "approval_proof_required",
    );
    expect(approvers.keys()).toEqual([]);
  });

  test("Given a nonce already used, Then enrolling with it again is refused", () => {
    const { approvers, open, enrollFirst } = setup();
    open("the-code");
    const payload = enrollFirst(device(), "wrong");
    expect(reasonOf(() => approvers.enroll(payload, ASKER))).toBe("approval_proof_required");
    expect(reasonOf(() => approvers.enroll(payload, ASKER))).toBe("approval_proof_required");
    expect(approvers.store.window()?.failed).toBe(1);
  });
});

describe("approvers: later keys are added and revoked by a key already enrolled", () => {
  function twoDevices() {
    const ctx = setup();
    const phone = device();
    ctx.open("the-code");
    ctx.approvers.enroll(ctx.enrollFirst(phone, "the-code"), ASKER);
    return { ...ctx, phone };
  }

  test("Given an enrolled key, When it signs for a new one, Then both are listed", () => {
    const { approvers, enrollAdd, phone } = twoDevices();
    const laptop = device();
    expect(approvers.enroll(enrollAdd(phone, laptop), ASKER).keyId).toBe(laptop.keyId);
    expect(approvers.list().keys.map((k) => k.name)).toEqual(["Ana's phone", "Laptop"]);
  });

  test("Given a signer that is not enrolled, or a key that is not P-256, Then adding is refused", () => {
    const { approvers, enrollAdd, phone } = twoDevices();
    const stranger = device();
    expect(reasonOf(() => approvers.enroll(enrollAdd(stranger, device()), ASKER))).toBe(
      "approval_proof_required",
    );
    const bad = { ...enrollAdd(phone, device()), publicKey: "Z2FyYmFnZQ==" };
    expect(reasonOf(() => approvers.enroll(bad, ASKER))).toBe("approval_proof_required");
    expect(approvers.keys().length).toBe(1);
  });

  test("Given two keys, When one revokes the other, Then one is left; the last key cannot be revoked", () => {
    const { approvers, enrollAdd, revokeOf, phone } = twoDevices();
    const laptop = device();
    approvers.enroll(enrollAdd(phone, laptop), ASKER);
    expect(approvers.revoke(revokeOf(laptop, phone.keyId))).toEqual({ keyId: phone.keyId });
    expect(approvers.keys().map((k) => k.keyId)).toEqual([laptop.keyId]);
    expect(reasonOf(() => approvers.revoke(revokeOf(laptop, laptop.keyId)))).toBe(
      "approval_last_key",
    );
    expect(approvers.keys().length).toBe(1);
  });

  test("Given a revoke signed by a key that is not enrolled, Then it is refused and nothing goes", () => {
    const { approvers, enrollAdd, revokeOf, phone } = twoDevices();
    approvers.enroll(enrollAdd(phone, device()), ASKER);
    expect(reasonOf(() => approvers.revoke(revokeOf(device(), phone.keyId)))).toBe(
      "approval_proof_required",
    );
    expect(approvers.keys().length).toBe(2);
  });

  test("Given the host terminal's reset, Then every key goes, the daemon keeps its id and protection is off", () => {
    const { approvers, enrollAdd, phone } = twoDevices();
    approvers.enroll(enrollAdd(phone, device()), ASKER);
    const id = approvers.daemonId();
    expect(approvers.store.reset()).toBe(2);
    expect(approvers.list()).toEqual({ daemonId: id, protectionOff: true, keys: [] });
  });
});
