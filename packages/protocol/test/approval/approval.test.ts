import { describe, expect, test } from "bun:test";
import {
  approvalDigests,
  approvalMessage,
  canonicalJson,
  commandDigest,
  commandMessage,
  commandNeedsProof,
  enrollAddMessage,
  enrollFirstMessage,
  needsApprovalProof,
  revokeMessage,
  vaultApproveMessage,
} from "../../src/approval.ts";
import { Command, ServerMessage } from "../../src/index.ts";

describe("approval-canonical: one byte string for one value, on both sides of the wire", () => {
  test("Given keys in any order, Then they are written in UTF-16 code unit order, as RFC 8785 sorts them", () => {
    const value = {
      "€": "Euro Sign",
      "\r": "Carriage Return",
      דּ: "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "😀": "Emoji: Grinning Face",
      "\u0080": "Control",
      ö: "Latin Small Letter O With Diaeresis",
    };
    // RFC 8785 section 3.2.3 order, read from the text: a parsed object lists "1" first anyway.
    const order = ["\r", "1", "\u0080", "\u00f6", "\u20ac", "\ud83d\ude00", "\ufb33"] as const;
    const at = (key: string) => (value as Record<string, string>)[key];
    const expected = `{${order.map((key) => `${JSON.stringify(key)}:${JSON.stringify(at(key))}`).join(",")}}`;
    expect(canonicalJson(value)).toBe(expected);
  });

  test("Given nested objects and arrays, Then there are no spaces and an array keeps its order", () => {
    expect(canonicalJson({ b: [3, { z: 1, a: null }], a: "x", c: true })).toBe(
      '{"a":"x","b":[3,{"a":null,"z":1}],"c":true}',
    );
  });

  test("Given a key set to undefined, Then it is left out; an undefined array item is null", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson([undefined, 1])).toBe("[null,1]");
  });

  test("Given a value JSON cannot carry, Then it throws instead of signing something else", () => {
    expect(() => canonicalJson({ n: Number.NaN })).toThrow();
    expect(() => canonicalJson({ n: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => canonicalJson({ n: 1n })).toThrow();
    expect(() => canonicalJson(() => 1)).toThrow();
  });

  test("Given a string with quotes and a control character, Then it is escaped as JSON escapes it", () => {
    expect(canonicalJson('a"b\n\u0001')).toBe('"a\\"b\\n\\u0001"');
  });
});

describe("approval-message: what a device signs binds the key, the host, the request and the answer", () => {
  const parts = {
    keyId: "k1",
    daemonId: "d1",
    requestId: "r1",
    nonce: "n1",
    permissionsHash: "aa",
    inputHash: "bb",
    messageHash: "cc",
  };

  test("Given the parts, Then the message is the canonical array with its domain tag first", () => {
    expect(approvalMessage(parts)).toBe(
      '["flightdeck/approval/v1","k1","d1","r1","n1","allow","aa","bb","cc"]',
    );
  });

  test("Given any one part changed, Then the signed text changes", () => {
    const base = approvalMessage(parts);
    for (const key of Object.keys(parts) as Array<keyof typeof parts>) {
      expect(approvalMessage({ ...parts, [key]: "other" })).not.toBe(base);
    }
  });

  test("Given the enroll and revoke messages, Then each has its own tag so none can stand for another", () => {
    const first = enrollFirstMessage({ daemonId: "d", nonce: "n", publicKey: "p", codeHash: "h" });
    const add = enrollAddMessage({ keyId: "k", daemonId: "d", nonce: "n", newPublicKey: "p" });
    const revoke = revokeMessage({ keyId: "k", daemonId: "d", nonce: "n", targetKeyId: "t" });
    expect(first).toBe('["flightdeck/enroll-first/v1","d","n","p","h"]');
    expect(add).toBe('["flightdeck/enroll-add/v1","k","d","n","p"]');
    expect(revoke).toBe('["flightdeck/revoke/v1","k","d","n","t"]');
  });

  test("Given an answer with no rules, no input and no message, Then the digests are the empty array, null and the empty text", () => {
    expect(approvalDigests({})).toEqual({ permissions: "[]", input: "null", message: "" });
  });

  test("Given rules and a changed input, Then the digests are their canonical text, key order aside", () => {
    expect(
      approvalDigests({
        updatedPermissions: [{ type: "setMode", mode: "plan", destination: "session" }],
        updatedInput: { b: 1, a: 2 },
        message: "ok",
      }),
    ).toEqual({
      permissions: '[{"destination":"session","mode":"plan","type":"setMode"}]',
      input: '{"a":2,"b":1}',
      message: "ok",
    });
  });
});

describe("approval-commands: the schemas of the approval commands and the proof on a respond", () => {
  const parse = (type: string, payload: unknown) =>
    Command.safeParse({ id: "1", type, payload }).success;

  test("Given a respond with a proof, Then it parses; a proof with an empty key id does not", () => {
    const proof = { keyId: "k", nonce: "n", signature: "s" };
    expect(parse("permission.respond", { requestId: "r", decision: "allow", proof })).toBe(true);
    expect(
      parse("permission.respond", {
        requestId: "r",
        decision: "allow",
        proof: { ...proof, keyId: "" },
      }),
    ).toBe(false);
  });

  test("Given the three purposes of a challenge, Then an approve needs the request and the others take none", () => {
    expect(parse("approval.challenge", { purpose: "approve", requestId: "r" })).toBe(true);
    expect(parse("approval.challenge", { purpose: "approve" })).toBe(false);
    expect(parse("approval.challenge", { purpose: "enroll" })).toBe(true);
    expect(parse("approval.challenge", { purpose: "revoke" })).toBe(true);
    expect(parse("approval.challenge", { purpose: "enroll", requestId: "r" })).toBe(false);
  });

  test("Given an enroll, Then a stray field is refused: nothing in it can open the window", () => {
    const enroll = { publicKey: "p", name: "Ana's phone", nonce: "n", signature: "s", code: "c" };
    expect(parse("approval.enroll", enroll)).toBe(true);
    expect(parse("approval.enroll", { ...enroll, windowMinutes: 60 })).toBe(false);
    expect(parse("approval.enroll", { ...enroll, name: "" })).toBe(false);
  });

  test("Given a revoke and a list, Then they parse and the list takes no payload", () => {
    const revoke = { targetKeyId: "t", signerKeyId: "k", nonce: "n", signature: "s" };
    expect(parse("approval.revoke", revoke)).toBe(true);
    expect(parse("approval.list", {})).toBe(true);
    expect(parse("approval.list", { all: true })).toBe(false);
  });
});

describe("approval-trigger: when an allow needs the proof of a device, for the host and the app alike", () => {
  test("Given the three cases, Then only a high risk or a saved rule needs a proof", () => {
    expect(needsApprovalProof("high", undefined)).toBe(true);
    expect(needsApprovalProof("medium", [{}])).toBe(true);
    expect(needsApprovalProof("low", [{}])).toBe(true);
    expect(needsApprovalProof("medium", [])).toBe(false);
    expect(needsApprovalProof("low", undefined)).toBe(false);
  });
});

describe("approval-watch: a client that watches hears when a device is enrolled or revoked (#3476)", () => {
  const parse = (type: string, payload: unknown) =>
    Command.safeParse({ id: "1", type, payload }).success;
  const enrolled = {
    type: "approval.enrolled",
    keyId: "k1",
    name: "Ana's phone",
    client: "flightdeck-app",
    address: "100.64.0.7",
    enrolledAt: "2026-11-20T12:00:00.000Z",
  };

  test("Given a watch, Then it takes no payload", () => {
    expect(parse("approval.watch", {})).toBe(true);
    expect(parse("approval.watch", { all: true })).toBe(false);
  });

  test("Given the two events, Then a server message carries each with its fields", () => {
    expect(ServerMessage.safeParse(enrolled).success).toBe(true);
    expect(ServerMessage.safeParse({ type: "approval.revoked", keyId: "k1" }).success).toBe(true);
  });

  test("Given an event that lacks the key id, Then it is not a server message", () => {
    const { keyId: _keyId, ...noKey } = enrolled;
    expect(ServerMessage.safeParse(noKey).success).toBe(false);
    expect(ServerMessage.safeParse({ type: "approval.revoked" }).success).toBe(false);
  });
});

describe("vault-approve: a device signs the use of a secret for one request and one scope (#3452)", () => {
  const parts = {
    keyId: "k1",
    daemonId: "d1",
    requestId: "r1",
    nonce: "n1",
    scope: "once",
  } as const;
  const parse = (payload: unknown) =>
    Command.safeParse({ id: "1", type: "vault.approve", payload });

  test("Given the parts, Then the message is the canonical array with its own tag first", () => {
    expect(vaultApproveMessage(parts)).toBe(
      '["flightdeck/vault-approve/v1","k1","d1","r1","n1","once"]',
    );
  });

  test("Given any one part changed, Then the signed text changes: the scope is signed too", () => {
    const base = vaultApproveMessage(parts);
    expect(vaultApproveMessage({ ...parts, scope: "session" })).not.toBe(base);
    for (const key of ["keyId", "daemonId", "requestId", "nonce"] as const) {
      expect(vaultApproveMessage({ ...parts, [key]: "other" })).not.toBe(base);
    }
  });

  test("Given a vault approve with a proof, Then the payload keeps it; the old fields stay accepted", () => {
    const proof = { keyId: "k1", nonce: "n1", signature: "sig" };
    const parsed = parse({ requestId: "r1", via: "app", scope: "once", proof });
    expect(
      parsed.success && "proof" in parsed.data.payload ? parsed.data.payload.proof : null,
    ).toEqual(proof);
    expect(parse({ requestId: "r1", via: "app", heldMs: 2000 }).success).toBe(true);
  });

  test("Given a proof that lacks its signature, Then the vault approve is not a command", () => {
    expect(
      parse({ requestId: "r1", via: "app", proof: { keyId: "k1", nonce: "n1" } }).success,
    ).toBe(false);
  });
});

describe("command-approve: a device signs the command and a hash of what it carries (#3453)", () => {
  const parts = {
    keyId: "k1",
    daemonId: "d1",
    command: "card.pr.merge",
    nonce: "n1",
    payloadHash: "ab".repeat(32),
  };
  const challenge = (payload: unknown) =>
    Command.safeParse({ id: "1", type: "approval.challenge", payload }).success;

  test("Given the parts, Then the message is the canonical array with its own tag first", () => {
    expect(commandMessage(parts)).toBe(
      `["flightdeck/command/v1","k1","d1","card.pr.merge","n1","${"ab".repeat(32)}"]`,
    );
  });

  test("Given the merge payload the Rust crate also reads, Then its digest and hash are the shared literals", () => {
    const payload = {
      prUrl: "https://github.com/acme/repo/pull/9",
      method: "squash",
      headSha: "a".repeat(40),
      confirm: true,
      cardId: "c1",
    };
    const digest = commandDigest(payload);
    expect(digest).toBe(
      '{"cardId":"c1","confirm":true,"headSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","method":"squash","prUrl":"https://github.com/acme/repo/pull/9"}',
    );
    expect(new Bun.CryptoHasher("sha256").update(digest).digest("hex")).toBe(
      "ab4ff38dd49488370b26c6082bcce7b9c06e7126faaf113cc562ef156d7c1e8e",
    );
  });

  test("Given the trust payload the Rust crate also reads, with a backslash and accents in the path, Then its digest and hash are the shared literals", () => {
    const digest = commandDigest({ trusted: true, path: "C:\\Users\\José\\código" });
    expect(digest).toBe('{"path":"C:\\\\Users\\\\José\\\\código","trusted":true}');
    expect(new Bun.CryptoHasher("sha256").update(digest).digest("hex")).toBe(
      "3e9907a6f46d40d59cbc41b9cd51ddc6b2c11c1ca2195fedc491e9f0643ec51f",
    );
  });

  test("Given any one part changed, Then the signed text changes", () => {
    const base = commandMessage(parts);
    for (const key of ["keyId", "daemonId", "command", "nonce", "payloadHash"] as const) {
      expect(commandMessage({ ...parts, [key]: "other" })).not.toBe(base);
    }
  });

  test("Given a payload with a proof, Then the digest leaves the proof out and sorts the keys", () => {
    const proof = { keyId: "k", nonce: "n", signature: "s" };
    expect(commandDigest({ method: "squash", cardId: "c", proof })).toBe(
      '{"cardId":"c","method":"squash"}',
    );
  });

  test("Given each command, Then only those that move code or trust need a proof, and a trust set fails closed", () => {
    expect([
      commandNeedsProof("card.pr.merge", { cardId: "c" }),
      commandNeedsProof("autoapprove.resume", {}),
      commandNeedsProof("project.trust.set", { trusted: true }),
      commandNeedsProof("project.trust.set", {}),
      commandNeedsProof("project.trust.set", { trusted: false }),
      commandNeedsProof("card.pr.create", { cardId: "c" }),
    ]).toEqual([true, true, true, true, false, false]);
  });

  test("Given a bypass switch (#3507), Then only the narrowing value is open: a missing or odd allow is gated", () => {
    expect([
      commandNeedsProof("host.bypass", { allow: true, confirm: true }),
      commandNeedsProof("host.bypass", { allow: false }),
      commandNeedsProof("host.bypass", {}),
      commandNeedsProof("host.bypass", { allow: "false" }),
      commandNeedsProof("host.bypass", { allow: 0 }),
      commandNeedsProof("host.bypass", null),
    ]).toEqual([true, false, true, true, true, true]);
  });

  test("Given a bypass switch with a proof, Then the payload keeps it; a proof that lacks its signature is refused", () => {
    const proof = { keyId: "k1", nonce: "n1", signature: "sig" };
    const parse = (payload: unknown) =>
      Command.safeParse({ id: "1", type: "host.bypass", payload });
    const parsed = parse({ allow: true, confirm: true, proof });
    expect(
      parsed.success && "proof" in parsed.data.payload ? parsed.data.payload.proof : null,
    ).toEqual(proof);
    expect(parse({ allow: true, confirm: true, proof: { keyId: "k1", nonce: "n1" } }).success).toBe(
      false,
    );
  });

  test("Given the bypass payload the Rust crate also reads, Then its digest and hash are the shared literals", () => {
    const digest = commandDigest({ confirm: true, allow: true });
    expect(digest).toBe('{"allow":true,"confirm":true}');
    expect(new Bun.CryptoHasher("sha256").update(digest).digest("hex")).toBe(
      "2ce79890e0ec3a64a198f2d1f21fab775c0f33e6bbccb797ed642ba413136f67",
    );
  });

  test("Given a folder added to a host's allowed folders (#3507), Then every payload of roots.add needs the proof: there is no narrowing value", () => {
    expect([
      commandNeedsProof("roots.add", { path: "/work", confirm: true }),
      commandNeedsProof("roots.add", { path: "/work" }),
      commandNeedsProof("roots.add", {}),
      commandNeedsProof("roots.add", null),
    ]).toEqual([true, true, true, true]);
  });

  test("Given roots.add with a proof, Then the payload keeps it; a proof that lacks its signature is refused", () => {
    const proof = { keyId: "k1", nonce: "n1", signature: "sig" };
    const parse = (payload: unknown) => Command.safeParse({ id: "1", type: "roots.add", payload });
    const parsed = parse({ path: "/work", confirm: true, proof });
    expect(
      parsed.success && "proof" in parsed.data.payload ? parsed.data.payload.proof : null,
    ).toEqual(proof);
    expect(
      parse({ path: "/work", confirm: true, proof: { keyId: "k1", nonce: "n1" } }).success,
    ).toBe(false);
  });

  test("Given the roots.add payload the Rust crate also reads, Then its digest and hash are the shared literals", () => {
    const digest = commandDigest({ path: "C:\\Users\\José\\código", confirm: true });
    expect(digest).toBe('{"confirm":true,"path":"C:\\\\Users\\\\José\\\\código"}');
    expect(new Bun.CryptoHasher("sha256").update(digest).digest("hex")).toBe(
      "33ef725f8a057e6ba6c4a7a90ef156230c763669d969fb952c2e86b020f2ff8c",
    );
  });

  test("Given a challenge for roots.add, Then it is one of the gate's commands", () => {
    expect(challenge({ purpose: "command", command: "roots.add" })).toBe(true);
  });

  test("Given a challenge for a command, Then it names a command of the gate; any other is refused", () => {
    expect([
      challenge({ purpose: "command", command: "card.pr.merge" }),
      challenge({ purpose: "command", command: "autoapprove.resume" }),
      challenge({ purpose: "command", command: "host.bypass" }),
      challenge({ purpose: "command", command: "session.start" }),
      challenge({ purpose: "command" }),
    ]).toEqual([true, true, true, false, false]);
  });
});
