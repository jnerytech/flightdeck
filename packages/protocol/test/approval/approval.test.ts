import { describe, expect, test } from "bun:test";
import {
  approvalDigests,
  approvalMessage,
  canonicalJson,
  enrollAddMessage,
  enrollFirstMessage,
  needsApprovalProof,
  revokeMessage,
} from "../../src/approval.ts";
import { Command } from "../../src/index.ts";

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
