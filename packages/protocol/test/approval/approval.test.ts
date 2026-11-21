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
  FEATURE_APPROVAL_RESUME,
  needsApprovalProof,
  revokeMessage,
  ruleLoosens,
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

  test("Given the resume payload the Rust crate also reads, Then its digest and hash are the shared literals", () => {
    const digest = commandDigest({ sessionKey: "card:c1", confirm: true });
    expect(digest).toBe('{"confirm":true,"sessionKey":"card:c1"}');
    expect(new Bun.CryptoHasher("sha256").update(digest).digest("hex")).toBe(
      "e0a91d4acb8e261e30090aa274dad9660a38643c12544415b7fc128214ff6e00",
    );
  });

  test("Given the resume command, Then it takes the proof and names its feature, and a field it does not know is refused", () => {
    const proof = { keyId: "k", nonce: "n", signature: "s" };
    const accepts = (payload: Record<string, unknown>) =>
      Command.safeParse({ id: "1", type: "autoapprove.resume", payload }).success;
    expect([
      FEATURE_APPROVAL_RESUME,
      accepts({ sessionKey: "card:c1", confirm: true, proof }),
      accepts({ sessionKey: "card:c1", confirm: true }),
      accepts({ sessionKey: "card:c1", confirm: true, extra: 1 }),
    ]).toEqual(["approval-resume", true, true, false]);
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

  test("Given the project.harness.apply payload the Rust crate also reads, Then its digest and hash are the shared literals", () => {
    const digest = commandDigest({
      path: "/work/api",
      parts: ["claudeMd", "hooks"],
      digests: { "CLAUDE.md": "d-claude", ".claude/settings.json": "d-settings" },
      confirm: true,
      reformat: true,
      template: "shop",
    });
    expect(digest).toBe(
      '{"confirm":true,"digests":{".claude/settings.json":"d-settings","CLAUDE.md":"d-claude"},"parts":["claudeMd","hooks"],"path":"/work/api","reformat":true,"template":"shop"}',
    );
    expect(new Bun.CryptoHasher("sha256").update(digest).digest("hex")).toBe(
      "0292c9b1e82f6513b3e80cb1b62d9cc667079b39ea1ad2650303d318379718bf",
    );
  });

  test("Given project.harness.apply, Then every payload of it needs the proof, and a challenge for it is one of the gate's", () => {
    expect([
      commandNeedsProof("project.harness.apply", { path: "/work/api", confirm: true }),
      commandNeedsProof("project.harness.apply", {}),
      challenge({ purpose: "command", command: "project.harness.apply" }),
    ]).toEqual([true, true, true]);
  });

  test("Given the plugins.install payloads the Rust crate also reads, Then their digests and hashes are the shared literals", () => {
    const confirmHash = "a".repeat(64);
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [
        {
          plugin: "deploy-tools@acme",
          scope: "project",
          confirmHash,
          acceptCommand: "b".repeat(64),
        },
        '{"acceptCommand":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","confirmHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","plugin":"deploy-tools@acme","scope":"project"}',
        "9f63013ef3891d7e3a3c30dbdb4812172f4c3d17e9f3babab503feae8cb0a2ef",
      ],
      [
        { dir: "/work/plugins/deploy", confirmHash },
        '{"confirmHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","dir":"/work/plugins/deploy"}',
        "6e0874106473077fddaefcda0cb2963d24ecfac81bbaa0bf0e63577df0798713",
      ],
      [
        { plugin: "deploy-tools@acme", confirmHash },
        '{"confirmHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","plugin":"deploy-tools@acme"}',
        "105dd69dedb5eeca4e9d83cfca9005986688a4bab71e3cc6450cd685c6d18198",
      ],
    ];
    for (const [payload, digest, hash] of cases) {
      expect(commandDigest(payload)).toBe(digest);
      expect(new Bun.CryptoHasher("sha256").update(digest).digest("hex")).toBe(hash);
    }
  });

  test("Given the plugins.marketplaceAdd payloads the Rust crate also reads, Then their digests and hashes are the shared literals, with confirm a boolean", () => {
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [
        { source: "acme/plugins", scope: "project", confirm: true },
        '{"confirm":true,"scope":"project","source":"acme/plugins"}',
        "3b35114cbdc6042f069fcce062b73a4429b48d707e85b3f32c7a0c099e1ad60d",
      ],
      [
        { source: "https://github.com/acme/plugins.git", confirm: true },
        '{"confirm":true,"source":"https://github.com/acme/plugins.git"}',
        "001a89ede03cbf690f714183364377e37f9cf37e612a3d6e6d7e6a5087bfcf31",
      ],
      [
        { source: "/work/marketplaces/acme", confirm: true },
        '{"confirm":true,"source":"/work/marketplaces/acme"}',
        "4a3dc658649368f9d5a2c2ed751b2a08d4b64c81a6f63df76136cb94b44c6dfa",
      ],
    ];
    for (const [payload, digest, hash] of cases) {
      expect(commandDigest(payload)).toBe(digest);
      expect(new Bun.CryptoHasher("sha256").update(digest).digest("hex")).toBe(hash);
    }
  });

  test("Given plugins.marketplaceAdd, Then every payload needs the proof and a challenge for it is one of the gate's", () => {
    expect([
      commandNeedsProof("plugins.marketplaceAdd", { source: "acme/plugins", confirm: true }),
      commandNeedsProof("plugins.marketplaceAdd", {}),
      challenge({ purpose: "command", command: "plugins.marketplaceAdd" }),
    ]).toEqual([true, true, true]);
  });

  test("Given the snippets.trust payloads the Rust crate also reads, Then their digests and hashes are the shared literals", () => {
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [
        { projectPath: "/work/app", hash: "a".repeat(64) },
        '{"hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","projectPath":"/work/app"}',
        "806ce00e17fd22b999d21804f3a49945e98211f9ffe9651d9c10c2667e69e1d9",
      ],
      [
        { projectPath: "/srv/flightdeck app", hash: "0123456789abcdef".repeat(4) },
        '{"hash":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","projectPath":"/srv/flightdeck app"}',
        "684bc21ef06bcde0cb6af55be1fdaeb58f291f0133ded2ac39012d0e0058a5cf",
      ],
    ];
    for (const [payload, digest, hash] of cases) {
      expect(commandDigest(payload)).toBe(digest);
      expect(new Bun.CryptoHasher("sha256").update(digest).digest("hex")).toBe(hash);
    }
  });

  test("Given the vault.rules.set payloads the Rust crate also reads, Then their digests and hashes are the shared literals", () => {
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [
        {
          secretId: "token",
          tags: [],
          rules: [
            {
              id: "r1",
              decision: "allow",
              match: { purpose: "ssh" },
              window: { days: ["mon"], from: "09:00", to: "17:00" },
            },
          ],
        },
        '{"rules":[{"decision":"allow","id":"r1","match":{"purpose":"ssh"},"window":{"days":["mon"],"from":"09:00","to":"17:00"}}],"secretId":"token","tags":[]}',
        "1817e1cbdc3e20f228ee6ac056cd0b507e14043f6e809b89ef27ea4244b44dd1",
      ],
      [
        {
          tags: ["prod", "ünï🙂"],
          rules: [
            {
              outsideWindow: "allow",
              decision: "ask",
              maxPerHour: 3,
              expiresAt: 1732000000000,
              note: 'a"b\n',
            },
            { id: "x", decision: "deny" },
          ],
          secretId: "sec_1.a-b",
        },
        '{"rules":[{"decision":"ask","expiresAt":1732000000000,"maxPerHour":3,"note":"a\\"b\\n","outsideWindow":"allow"},{"decision":"deny","id":"x"}],"secretId":"sec_1.a-b","tags":["prod","ünï🙂"]}',
        "62f1d773bc7709ed39ab25777b9732ed56c1fa2543cd0866f0b1a0617220e83f",
      ],
    ];
    for (const [payload, digest, hash] of cases) {
      expect(commandDigest(payload)).toBe(digest);
      expect(new Bun.CryptoHasher("sha256").update(digest).digest("hex")).toBe(hash);
    }
  });

  test("Given snippets.trust, Then every payload needs the proof (there is no untrust to leave open) and a challenge for it is one of the gate's", () => {
    expect([
      commandNeedsProof("snippets.trust", { projectPath: "/work/app", hash: "a".repeat(64) }),
      commandNeedsProof("snippets.trust", {}),
      challenge({ purpose: "command", command: "snippets.trust" }),
    ]).toEqual([true, true, true]);
  });

  test("Given snippets.trust, Then it takes an optional proof and still refuses a field it does not know", () => {
    const base = { projectPath: "/work/app", hash: "a".repeat(64) };
    const proof = { keyId: "k1", nonce: "n1", signature: "c2ln" };
    const parse = (payload: unknown) =>
      Command.safeParse({ id: "1", type: "snippets.trust", payload }).success;
    expect([parse(base), parse({ ...base, proof }), parse({ ...base, extra: 1 })]).toEqual([
      true,
      true,
      false,
    ]);
  });

  test("Given a rule, Then it loosens when its decision or its outsideWindow is allow, and an item that is no rule is taken as loosening (#3754)", () => {
    expect([
      ruleLoosens({ id: "a", decision: "allow" }),
      ruleLoosens({ id: "b", decision: "ask", outsideWindow: "allow" }),
      ruleLoosens({ id: "c", decision: "ask" }),
      ruleLoosens({ id: "d", decision: "deny", outsideWindow: "deny" }),
      ruleLoosens("allow"),
      ruleLoosens(null),
      ruleLoosens(["allow"]),
      ruleLoosens(7),
    ]).toEqual([true, true, false, false, true, true, true, true]);
  });

  test("Given vault.rules.set, Then a payload with a rule that loosens needs the proof and one of ask and deny rules, or none, needs none (#3754)", () => {
    const set = (rules: unknown) => commandNeedsProof("vault.rules.set", { secretId: "s", rules });
    expect([
      set([{ id: "a", decision: "allow" }]),
      set([
        { id: "a", decision: "ask" },
        { id: "b", decision: "deny", outsideWindow: "allow" },
      ]),
      set([
        { id: "a", decision: "ask" },
        { id: "b", decision: "deny" },
      ]),
      set([]),
      // Fail closed: a payload the host cannot read as a list of rules is gated.
      set("allow"),
      set(undefined),
      set([null]),
      commandNeedsProof("vault.rules.set", null),
    ]).toEqual([true, true, false, false, true, true, true, true]);
  });

  test("Given vault.rules.set, Then it takes an optional proof, and a challenge for it is one of the gate's (#3754)", () => {
    const base = { secretId: "s", tags: ["prod"], rules: [{ id: "a", decision: "allow" }] };
    const proof = { keyId: "k1", nonce: "n1", signature: "c2ln" };
    const parse = (payload: unknown) =>
      Command.safeParse({ id: "1", type: "vault.rules.set", payload }).success;
    expect([
      parse(base),
      parse({ ...base, proof }),
      challenge({ purpose: "command", command: "vault.rules.set" }),
    ]).toEqual([true, true, true]);
  });

  test("Given the plugin commands, Then every payload of install and update needs the proof, and a challenge for each is one of the gate's", () => {
    expect([
      commandNeedsProof("plugins.install", { plugin: "deploy-tools@acme", confirmHash: "x" }),
      commandNeedsProof("plugins.install", {}),
      commandNeedsProof("plugins.update", { plugin: "deploy-tools@acme", confirmHash: "x" }),
      commandNeedsProof("plugins.update", {}),
      challenge({ purpose: "command", command: "plugins.install" }),
      challenge({ purpose: "command", command: "plugins.update" }),
    ]).toEqual([true, true, true, true, true, true]);
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
