import { describe, expect, test } from "bun:test";
import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import {
  type ApprovalAnswer,
  type ApprovalProof,
  approvalDigests,
  approvalMessage,
  commandDigest,
  commandMessage,
  needsApprovalProof,
} from "@flightdeck/protocol";
import {
  ApprovalGate,
  type EnrolledKey,
  keyIdOf,
  sha256Hex,
  verifySignature,
} from "../../src/permissions/domain/approval-gate.ts";
import { NonceBook } from "../../src/permissions/domain/nonce-book.ts";

function device() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spki = publicKey.export({ type: "spki", format: "der" });
  const pub = spki.toString("base64");
  const keyId = createHash("sha256").update(spki).digest("hex");
  const signText = (text: string) =>
    sign("sha256", Buffer.from(text), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString(
      "base64",
    );
  return { pub, keyId, signText };
}

function setup() {
  const clock = { at: 1_000 };
  let n = 0;
  const nonces = new NonceBook({ mono: () => clock.at, random: () => `nonce-${++n}` });
  const keys: EnrolledKey[] = [];
  const gate = new ApprovalGate({ keys: () => keys, daemonId: () => "daemon-1", nonces });
  const phone = device();
  keys.push({ keyId: phone.keyId, publicKey: phone.pub });
  const prove = (
    requestId: string,
    answer: ApprovalAnswer = {},
    over: { signedFor?: string; nonce?: string } = {},
  ): ApprovalProof => {
    const nonce = over.nonce ?? nonces.issue("approve", requestId, 1);
    const d = approvalDigests(answer);
    const message = approvalMessage({
      keyId: phone.keyId,
      daemonId: "daemon-1",
      requestId: over.signedFor ?? requestId,
      nonce,
      permissionsHash: sha256Hex(d.permissions),
      inputHash: sha256Hex(d.input),
      messageHash: sha256Hex(d.message),
    });
    return { keyId: phone.keyId, nonce, signature: phone.signText(message) };
  };
  return { gate, keys, nonces, clock, phone, prove };
}

const refusal = (fn: () => void) => {
  try {
    fn();
  } catch (error) {
    const e = error as { reason?: string; message: string; params?: unknown };
    return { reason: e.reason, text: `${e.message} ${JSON.stringify(e.params ?? {})}` };
  }
  return undefined;
};

describe("approval-crypto: ids, digests and signatures", () => {
  test("Given a public key, Then its id is the hex SHA-256 of the SPKI DER", () => {
    const { pub, keyId } = device();
    expect(keyIdOf(pub)).toBe(keyId);
    expect(sha256Hex("abc")).toBe(createHash("sha256").update("abc").digest("hex"));
  });

  test("Given a signature of the text, Then it verifies; another text, another key or garbage does not", () => {
    const a = device();
    const b = device();
    const sig = a.signText("hello");
    expect(verifySignature(a.pub, "hello", sig)).toBe(true);
    expect(verifySignature(a.pub, "hellO", sig)).toBe(false);
    expect(verifySignature(b.pub, "hello", sig)).toBe(false);
    expect(verifySignature(a.pub, "hello", "not base64 !!")).toBe(false);
    expect(verifySignature("garbage", "hello", sig)).toBe(false);
    expect(
      createPublicKey({ key: Buffer.from(a.pub, "base64"), format: "der", type: "spki" }),
    ).toBeDefined();
  });

  test("Given the three cases, Then only a high risk or a saved rule needs a proof", () => {
    expect(needsApprovalProof("high", [])).toBe(true);
    expect(needsApprovalProof("medium", [{}])).toBe(true);
    expect(needsApprovalProof("low", [{}])).toBe(true);
    expect(needsApprovalProof("medium", [])).toBe(false);
    expect(needsApprovalProof("low", [])).toBe(false);
  });
});

describe("approval-gate: a host with no enrolled key behaves as before", () => {
  test("Given no key, When a high-risk allow comes without the hold, Then hold_required; with it, it passes", () => {
    const { gate, keys } = setup();
    keys.length = 0;
    expect(refusal(() => gate.check({ requestId: "r1", risk: "high", answer: {} }))?.reason).toBe(
      "hold_required",
    );
    expect(
      refusal(() => gate.check({ requestId: "r1", risk: "high", answer: {}, held: true })),
    ).toBeUndefined();
  });

  test("Given no key, When a low-risk allow saves a rule, Then it passes with no hold and no proof", () => {
    const { gate, keys } = setup();
    keys.length = 0;
    const answer = {
      updatedPermissions: [{ type: "setMode", mode: "plan", destination: "session" }],
    };
    expect(refusal(() => gate.check({ requestId: "r1", risk: "low", answer }))).toBeUndefined();
  });
});

describe("approval-gate: with a key enrolled, an allow that needs a proof carries one", () => {
  test("Given a key, When a low-risk allow saves nothing, Then no proof is needed", () => {
    const { gate } = setup();
    expect(refusal(() => gate.check({ requestId: "r1", risk: "low", answer: {} }))).toBeUndefined();
    expect(
      refusal(() => gate.check({ requestId: "r1", risk: "medium", answer: {} })),
    ).toBeUndefined();
  });

  test("Given a key, When a high-risk allow has the hold but no proof, Then approval_proof_required: the hold is no longer enough", () => {
    const { gate } = setup();
    expect(
      refusal(() => gate.check({ requestId: "r1", risk: "high", answer: {}, held: true }))?.reason,
    ).toBe("approval_proof_required");
  });

  test("Given a valid proof, When the allow is checked, Then it passes once and the same proof is refused after", () => {
    const { gate, prove } = setup();
    const proof = prove("r1");
    expect(
      refusal(() => gate.check({ requestId: "r1", risk: "high", answer: {}, proof })),
    ).toBeUndefined();
    expect(
      refusal(() => gate.check({ requestId: "r1", risk: "high", answer: {}, proof }))?.reason,
    ).toBe("approval_proof_required");
  });

  test("Given a proof of a medium-risk allow that saves a rule, Then it is needed and it passes with the proof", () => {
    const { gate, prove } = setup();
    const answer = {
      updatedPermissions: [{ type: "setMode", mode: "plan", destination: "session" }],
    };
    expect(refusal(() => gate.check({ requestId: "r1", risk: "medium", answer }))?.reason).toBe(
      "approval_proof_required",
    );
    const proof = prove("r1", answer);
    expect(
      refusal(() => gate.check({ requestId: "r1", risk: "medium", answer, proof })),
    ).toBeUndefined();
  });

  test("Given a proof signed for one answer, When the allow carries another rule, input or message, Then it is refused and the nonce is not burnt", () => {
    const { gate, prove, nonces } = setup();
    const nonce = nonces.issue("approve", "r1", 1);
    const signed = prove("r1", {}, { nonce });
    const other = [
      { updatedPermissions: [{ type: "setMode", mode: "plan", destination: "session" }] },
      { updatedInput: { command: "rm -rf /" } },
      { message: "go" },
    ];
    for (const answer of other) {
      expect(
        refusal(() => gate.check({ requestId: "r1", risk: "high", answer, proof: signed }))?.reason,
      ).toBe("approval_proof_required");
    }
    expect(
      refusal(() => gate.check({ requestId: "r1", risk: "high", answer: {}, proof: signed })),
    ).toBeUndefined();
  });

  test("Given the rules written with their keys in another order, Then the proof still holds", () => {
    const { gate, prove } = setup();
    const signedAs = {
      updatedPermissions: [{ type: "setMode", mode: "plan", destination: "session" }],
    };
    const sentAs = {
      updatedPermissions: [{ destination: "session", mode: "plan", type: "setMode" }],
    };
    const proof = prove("r1", signedAs);
    expect(
      refusal(() => gate.check({ requestId: "r1", risk: "high", answer: sentAs, proof })),
    ).toBeUndefined();
  });

  test("Given a proof for another request, When it is used on this one, Then it is refused, and so is a nonce issued for another request", () => {
    const { gate, prove, nonces } = setup();
    const forOther = prove("r1", {}, { signedFor: "r2" });
    expect(
      refusal(() => gate.check({ requestId: "r2", risk: "high", answer: {}, proof: forOther }))
        ?.reason,
    ).toBe("approval_proof_required");
    const reuse = prove("r2");
    expect(
      refusal(() => gate.check({ requestId: "r1", risk: "high", answer: {}, proof: reuse }))
        ?.reason,
    ).toBe("approval_proof_required");
    expect(nonces.take(reuse.nonce, "approve", "r2")).toBe("ok");
  });

  test("Given a nonce past its sixty seconds, Then approval_challenge_expired, and a new press is needed", () => {
    const { gate, prove, clock } = setup();
    const proof = prove("r1");
    clock.at += 61_000;
    expect(
      refusal(() => gate.check({ requestId: "r1", risk: "high", answer: {}, proof }))?.reason,
    ).toBe("approval_challenge_expired");
  });

  test("Given an unknown key id, or a key id signed by another key, Then it is refused", () => {
    const { gate, prove, nonces } = setup();
    const proof = prove("r1");
    expect(
      refusal(() =>
        gate.check({
          requestId: "r1",
          risk: "high",
          answer: {},
          proof: { ...proof, keyId: "nope" },
        }),
      )?.reason,
    ).toBe("approval_proof_required");
    const stranger = device();
    const nonce = nonces.issue("approve", "r1", 1);
    const forged = { keyId: proof.keyId, nonce, signature: stranger.signText("anything") };
    expect(
      refusal(() => gate.check({ requestId: "r1", risk: "high", answer: {}, proof: forged }))
        ?.reason,
    ).toBe("approval_proof_required");
  });

  test("Given a key revoked or enrolled after the gate was built, Then the next check sees it", () => {
    const { gate, keys, prove } = setup();
    const proof = prove("r1");
    const [phone] = keys.splice(0);
    const held = { requestId: "r1", risk: "high", answer: {}, held: true } as const;
    expect(refusal(() => gate.check({ ...held, held: false }))?.reason).toBe("hold_required");
    expect(refusal(() => gate.check(held))).toBeUndefined();
    if (phone) keys.push(phone);
    expect(refusal(() => gate.check(held))?.reason).toBe("approval_proof_required");
    expect(
      refusal(() => gate.check({ requestId: "r1", risk: "high", answer: {}, proof })),
    ).toBeUndefined();
  });

  test("Given any refusal, Then its text carries no nonce, key or signature", () => {
    const { gate, prove, phone } = setup();
    const proof = prove("r1");
    const bad = { ...proof, signature: phone.signText("other") };
    for (const attempt of [bad, proof]) {
      const seen = refusal(() =>
        gate.check({ requestId: "r2", risk: "high", answer: {}, proof: attempt }),
      );
      expect(seen?.text.includes(attempt.nonce)).toBe(false);
      expect(seen?.text.includes(attempt.signature)).toBe(false);
      expect(seen?.text.includes(phone.pub)).toBe(false);
      expect(seen?.text.includes(phone.keyId)).toBe(false);
    }
  });
});

describe("approval-command: a command that moves code or trust takes the proof of a device (#3453)", () => {
  const MERGE = {
    cardId: "c1",
    method: "squash",
    confirm: true,
    prUrl: "u",
    headSha: "a".repeat(40),
  };

  function commandSetup() {
    const t = setup();
    const prove = (
      command: string,
      payload: Record<string, unknown>,
      over: { signedFor?: string; signedPayload?: Record<string, unknown>; nonce?: string } = {},
    ): ApprovalProof => {
      const nonce = over.nonce ?? t.nonces.issue("command", command, 1);
      const message = commandMessage({
        keyId: t.phone.keyId,
        daemonId: "daemon-1",
        command: over.signedFor ?? command,
        nonce,
        payloadHash: sha256Hex(commandDigest(over.signedPayload ?? payload)),
      });
      return { keyId: t.phone.keyId, nonce, signature: t.phone.signText(message) };
    };
    return { ...t, prove };
  }

  test("Given a proof over this command and payload, Then it passes once; the same nonce again is refused", () => {
    const { gate, prove } = commandSetup();
    const proof = prove("card.pr.merge", MERGE);
    expect(refusal(() => gate.checkCommand("card.pr.merge", { ...MERGE, proof }))).toBeUndefined();
    expect(refusal(() => gate.checkCommand("card.pr.merge", { ...MERGE, proof }))?.reason).toBe(
      "approval_proof_required",
    );
  });

  test("Given a payload changed after it was signed, Then it is refused: the head and the method are signed", () => {
    const { gate, prove } = commandSetup();
    for (const change of [{ headSha: "b".repeat(40) }, { method: "merge" }, { prUrl: "other" }]) {
      const proof = prove("card.pr.merge", MERGE);
      expect(
        refusal(() => gate.checkCommand("card.pr.merge", { ...MERGE, ...change, proof }))?.reason,
      ).toBe("approval_proof_required");
    }
  });

  test("Given a proof for another command, Then it is refused", () => {
    const { gate, prove } = commandSetup();
    const proof = prove("card.pr.merge", MERGE, { signedFor: "autoapprove.resume" });
    expect(refusal(() => gate.checkCommand("card.pr.merge", { ...MERGE, proof }))?.reason).toBe(
      "approval_proof_required",
    );
  });

  test("Given no proof, an unknown key or a nonce made for an approval, Then each is refused the same way", () => {
    const { gate, prove, nonces, keys } = commandSetup();
    const stranger = { keyId: "nobody", nonce: "x", signature: "y" };
    const approval = prove("card.pr.merge", MERGE, { nonce: nonces.issue("approve", "r1", 1) });
    for (const proof of [undefined, stranger, approval]) {
      expect(
        refusal(() => gate.checkCommand("card.pr.merge", { ...MERGE, ...(proof ? { proof } : {}) }))
          ?.reason,
      ).toBe("approval_proof_required");
    }
    expect(keys.length).toBe(1);
  });

  test("Given a forged signature, Then the nonce is not burned: the real proof with it still passes", () => {
    const { gate, prove, phone } = commandSetup();
    const proof = prove("card.pr.merge", MERGE);
    const forged = { ...proof, signature: phone.signText("other") };
    expect(
      refusal(() => gate.checkCommand("card.pr.merge", { ...MERGE, proof: forged })),
    ).toBeDefined();
    expect(refusal(() => gate.checkCommand("card.pr.merge", { ...MERGE, proof }))).toBeUndefined();
  });

  test("Given a proof past its sixty seconds, Then the refusal says the challenge expired", () => {
    const { gate, prove, clock } = commandSetup();
    const proof = prove("card.pr.merge", MERGE);
    clock.at += 61_000;
    expect(refusal(() => gate.checkCommand("card.pr.merge", { ...MERGE, proof }))?.reason).toBe(
      "approval_challenge_expired",
    );
  });

  test("Given a refusal, Then its text names no key, nonce or signature and says what is needed", () => {
    const { gate, prove, phone } = commandSetup();
    const proof = prove("card.pr.merge", MERGE);
    const bad = { ...proof, signature: phone.signText("other") };
    const seen = refusal(() => gate.checkCommand("card.pr.merge", { ...MERGE, proof: bad }));
    expect(seen?.text.includes("confirmation of an enrolled device")).toBe(true);
    expect(
      [proof.nonce, bad.signature, phone.pub, phone.keyId].some((s) => seen?.text.includes(s)),
    ).toBe(false);
  });
});
