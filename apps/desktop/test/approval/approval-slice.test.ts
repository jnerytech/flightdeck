import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  approvalDigests,
  approvalMessage,
  Command,
  commandDigest,
  commandMessage,
  enrollAddMessage,
  enrollFirstMessage,
  FEATURE_APPROVAL_BYPASS,
  FEATURE_APPROVAL_COMMAND,
  FEATURE_APPROVAL_PROOF,
  FEATURE_APPROVAL_RESUME,
  FEATURE_APPROVAL_TRUST,
  FEATURE_APPROVAL_VAULT,
  type PermissionUpdate,
  revokeMessage,
  vaultApproveMessage,
} from "@flightdeck/protocol";
import { decodeAdd, encodeAdd } from "../../src/features/approval/add-text.ts";
import { ApprovalSlice } from "../../src/features/approval/index.ts";
import { refusalText } from "../../src/i18n/errors.ts";
import { translator } from "../../src/i18n/index.ts";
import type { HostResult } from "../../src/lib/kernel.ts";

const t = translator("en");
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const shaBytes = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
/** A P-256 key's SPKI is 91 bytes; these are stand-ins of that size. */
const spki = (fill: number) => Buffer.alloc(91, fill).toString("base64");
const KEY = { publicKey: spki(7), keyId: "key-this" };
const NEW_KEY = spki(9);
const OTHER_PUBLIC = spki(3);
/** What both devices show: sixteen characters of the key's id, in groups of four. */
const printOf = (publicKey: string) =>
  shaBytes(Buffer.from(publicKey, "base64"))
    .slice(0, 16)
    .replace(/(.{4})(?=.)/g, "$1-");
const OTHER = { keyId: "key-other", name: "Laptop", client: "app", enrolledAt: "x", address: "a" };
const THIS = { keyId: "key-this", name: "Phone", client: "app", enrolledAt: "x", address: "a" };

/** A slice over stand-ins: the host's answers by command, the key port, and what went out. */
function approval(
  over: {
    features?: string[];
    keys?: "none" | "port";
    local?: typeof KEY | null;
    list?: { protectionOff: boolean; keys: Array<typeof THIS> };
    refuse?: string;
    signFails?: string;
    /** Runs while the host handles `approval.revoke`: the announcement arrives before the answer. */
    onRevoke?: (slice: ApprovalSlice) => unknown;
    /** Runs while the host handles `approval.enroll`: the announcement arrives before the answer. */
    onEnroll?: (slice: ApprovalSlice) => unknown;
  } = {},
) {
  const log: Array<{ type: string; payload?: unknown }> = [];
  const keyLog: Array<{ op: string; args: unknown[] }> = [];
  const notices: Array<{ kind: "success" | "fail"; text: string }> = [];
  let local = over.local === undefined ? KEY : over.local;
  const slice = new ApprovalSlice({
    keys: () =>
      over.keys === "none"
        ? undefined
        : {
            get: async (id) => {
              keyLog.push({ op: "get", args: [id] });
              return local;
            },
            create: async (id) => {
              keyLog.push({ op: "create", args: [id] });
              local = KEY;
              return KEY;
            },
            delete: async (id) => {
              keyLog.push({ op: "delete", args: [id] });
              local = null;
            },
            sign: async (id, message, lang, payload) => {
              keyLog.push({
                op: "sign",
                args: payload === undefined ? [id, message, lang] : [id, message, lang, payload],
              });
              if (over.signFails) throw over.signFails;
              return `sig:${message}`;
            },
          },
    host: () => ({
      features: over.features ?? [FEATURE_APPROVAL_PROOF],
      daemonId: "daemon-1",
      name: "pi",
    }),
    request: (async (_hostId: string, type: string, payload: unknown) => {
      log.push({ type, payload });
      if (type === "approval.revoke") await over.onRevoke?.(slice);
      if (type === "approval.enroll") await over.onEnroll?.(slice);
      if (over.refuse === type) {
        return { ok: false, code: "refused", message: "no", reason: "approval_last_key" };
      }
      const data: Record<string, unknown> = {
        "approval.list": {
          daemonId: "daemon-1",
          ...(over.list ?? { protectionOff: false, keys: [THIS] }),
        },
        "approval.challenge": { nonce: "nonce-1", daemonId: "daemon-1", expiresInMs: 60_000 },
        "approval.enroll": { keyId: KEY.keyId, daemonId: "daemon-1" },
        "approval.revoke": { keyId: OTHER.keyId },
        "card.pr.head": { prUrl: "https://github.com/acme/repo/pull/9", headSha: "a".repeat(40) },
      };
      return { ok: true, data: data[type] };
    }) as never as () => Promise<HostResult<never>>,
    lang: () => "en",
    t: () => t,
    success: (text) => notices.push({ kind: "success", text }),
    fail: (text) => notices.push({ kind: "fail", text }),
  });
  return { slice, log, keyLog, notices };
}

const rule: PermissionUpdate = {
  type: "addRules",
  rules: [{ toolName: "Bash", ruleContent: "ls" }],
  behavior: "allow",
  destination: "localSettings",
};

describe("approval: the proof of a high-risk allow (#3439)", () => {
  test("a low allow and a deny need no proof and ask the host nothing", async () => {
    const { slice, log } = approval();
    expect(await slice.prove("h", { requestId: "r", decision: "allow" }, "low")).toEqual({
      kind: "none",
    });
    expect(await slice.prove("h", { requestId: "r", decision: "deny" }, "high")).toEqual({
      kind: "none",
    });
    expect(log).toEqual([]);
  });

  test("a host without the feature, an app without keys, or a host with protection off: the hold is the whole guard", async () => {
    for (const setup of [
      approval({ features: [] }),
      approval({ keys: "none" }),
      approval({ list: { protectionOff: true, keys: [] } }),
    ]) {
      expect(await setup.slice.prove("h", { requestId: "r", decision: "allow" }, "high")).toEqual({
        kind: "none",
      });
      expect(setup.keyLog.filter((k) => k.op === "sign")).toEqual([]);
    }
  });

  test("a high allow is signed over the message the host rebuilds, for the request the nonce was asked for", async () => {
    const { slice, log, keyLog } = approval();
    const result = await slice.prove("h", { requestId: "r1", decision: "allow" }, "high");
    const digests = approvalDigests({});
    const message = approvalMessage({
      keyId: "key-this",
      daemonId: "daemon-1",
      requestId: "r1",
      nonce: "nonce-1",
      permissionsHash: sha(digests.permissions),
      inputHash: sha(digests.input),
      messageHash: sha(digests.message),
    });
    expect(result).toEqual({
      kind: "proof",
      proof: { keyId: "key-this", nonce: "nonce-1", signature: `sig:${message}` },
    });
    expect(log.map((l) => l.type)).toEqual(["approval.list", "approval.challenge"]);
    expect(log[1]?.payload).toEqual({ purpose: "approve", requestId: "r1" });
    expect(keyLog.find((k) => k.op === "sign")?.args).toEqual(["daemon-1", message, "en"]);
  });

  test("a low allow that saves a rule is signed too, and the rule is in what the proof covers", async () => {
    const { slice, keyLog } = approval();
    const result = await slice.prove(
      "h",
      { requestId: "r1", decision: "allow", updatedPermissions: [rule], message: "ok" },
      "low",
    );
    expect(result.kind).toBe("proof");
    const digests = approvalDigests({ updatedPermissions: [rule], message: "ok" });
    const signed = String(keyLog.find((k) => k.op === "sign")?.args[1]);
    expect(signed).toContain(sha(digests.permissions));
    expect(signed).toContain(sha(digests.message));
  });

  test("a request whose risk is not known is treated as high when the host is protected", async () => {
    const { slice } = approval();
    const result = await slice.prove("h", { requestId: "r1", decision: "allow" }, undefined);
    expect(result.kind).toBe("proof");
  });

  test("when the person declines the system's dialog, nothing is sent and no error is raised", async () => {
    const { slice } = approval({ signFails: "declined" });
    expect(await slice.prove("h", { requestId: "r", decision: "allow" }, "high")).toEqual({
      kind: "declined",
    });
  });

  test("a device with no key for this host, or whose key the host does not list, is told so, in words", async () => {
    for (const setup of [
      approval({ local: null }),
      approval({ list: { protectionOff: false, keys: [OTHER] } }),
    ]) {
      await expect(
        setup.slice.prove("h", { requestId: "r", decision: "allow" }, "high"),
      ).rejects.toThrow(t("approvalDevices.noKeyHere"));
    }
  });

  test("a refusal of the list or of the challenge reaches the person as text, never a code", async () => {
    for (const type of ["approval.list", "approval.challenge"]) {
      const { slice } = approval({ refuse: type });
      await expect(slice.prove("h", { requestId: "r", decision: "allow" }, "high")).rejects.toThrow(
        refusalText("refused", "no", t, { reason: "approval_last_key" }),
      );
    }
  });
});

describe("approval: this device's key on a host's page (#3439)", () => {
  test("the status lists the host's keys and says which one is this device's", async () => {
    const { slice } = approval({ list: { protectionOff: false, keys: [OTHER, THIS] } });
    expect(await slice.status("h")).toEqual({
      protectionOff: false,
      keys: [OTHER, THIS],
      thisKeyId: "key-this",
    });
    const none = approval({ local: null });
    expect((await none.slice.status("h")).thisKeyId).toBeNull();
  });

  test("a feature-less host or an app without keys is not supported", () => {
    expect(approval().slice.supported("h")).toBe(true);
    expect(approval({ features: [] }).slice.supported("h")).toBe(false);
    expect(approval({ keys: "none" }).slice.supported("h")).toBe(false);
  });

  test("enrolling makes the key, signs the first-enrollment text with the hash of the code, and sends it", async () => {
    const { slice, log, keyLog } = approval({ local: null });
    await slice.enroll("h", "My phone", "the-code");
    const message = enrollFirstMessage({
      daemonId: "daemon-1",
      nonce: "nonce-1",
      publicKey: KEY.publicKey,
      codeHash: sha("the-code"),
    });
    expect(keyLog.map((k) => k.op)).toEqual(["get", "create", "sign"]);
    expect(log.map((l) => l.type)).toEqual([
      "approval.list",
      "approval.challenge",
      "approval.enroll",
    ]);
    expect(log[1]?.payload).toEqual({ purpose: "enroll" });
    expect(log[2]?.payload).toEqual({
      publicKey: KEY.publicKey,
      name: "My phone",
      nonce: "nonce-1",
      signature: `sig:${message}`,
      code: "the-code",
    });
  });

  test("a refused enrollment leaves no key on this device", async () => {
    const { slice, keyLog } = approval({
      local: null,
      refuse: "approval.enroll",
      list: { protectionOff: true, keys: [] },
    });
    await expect(slice.enroll("h", "My phone", "wrong")).rejects.toThrow();
    expect(keyLog.at(-1)).toEqual({ op: "delete", args: ["daemon-1"] });
  });

  test("a declined dialog is an outcome of its own, and the key made for it is dropped", async () => {
    const { slice, keyLog } = approval({ local: null, signFails: "declined" });
    expect(await slice.enroll("h", "My phone", "code")).toBe("declined");
    expect(keyLog.at(-1)).toEqual({ op: "delete", args: ["daemon-1"] });
    const revoker = approval({ signFails: "declined" });
    expect(await revoker.slice.revoke("h", "key-other")).toBe("declined");
    expect(revoker.log.map((l) => l.type)).toEqual(["approval.challenge"]);
  });

  test("an error after the host listed this key keeps the key: the host trusts it", async () => {
    const { slice, keyLog } = approval({ local: null, refuse: "approval.enroll" });
    await expect(slice.enroll("h", "My phone", "code")).rejects.toThrow();
    expect(keyLog.filter((k) => k.op === "delete")).toEqual([]);
  });

  test("a key the host does not list is stale: enrolling replaces it", async () => {
    const { slice, keyLog } = approval({ list: { protectionOff: true, keys: [] } });
    expect(await slice.enroll("h", "My phone", "code")).toBe("done");
    expect(keyLog.map((k) => k.op)).toEqual(["get", "delete", "create", "sign"]);
  });

  test("a device that already holds a key for the host does not make another", async () => {
    const { slice, keyLog } = approval();
    await expect(slice.enroll("h", "My phone", "code")).rejects.toThrow(
      t("approvalDevices.hasKeyHere"),
    );
    expect(keyLog.filter((k) => k.op === "create")).toEqual([]);
  });

  test("a revoke is signed by this device's key and names the key to remove", async () => {
    const { slice, log } = approval();
    await slice.revoke("h", "key-other");
    const message = revokeMessage({
      keyId: "key-this",
      daemonId: "daemon-1",
      nonce: "nonce-1",
      targetKeyId: "key-other",
    });
    expect(log[0]?.payload).toEqual({ purpose: "revoke" });
    expect(log[1]).toEqual({
      type: "approval.revoke",
      payload: {
        targetKeyId: "key-other",
        signerKeyId: "key-this",
        nonce: "nonce-1",
        signature: `sig:${message}`,
      },
    });
  });

  test("a device with no key cannot revoke; removing the local key deletes only this device's", async () => {
    const none = approval({ local: null });
    await expect(none.slice.revoke("h", "key-other")).rejects.toThrow(
      t("approvalDevices.noKeyHere"),
    );
    const { slice, keyLog } = approval();
    await slice.removeLocalKey("h");
    expect(keyLog).toEqual([{ op: "delete", args: ["daemon-1"] }]);
  });
});

describe("approval: adding a second device (#3478)", () => {
  const text = (over: Partial<Parameters<typeof encodeAdd>[0]> = {}) =>
    encodeAdd({ daemonId: "daemon-1", publicKey: NEW_KEY, name: "Laptop", ...over });

  test("a new device makes its key and shows a text that carries the key, the host and the name", async () => {
    const { slice, log, keyLog } = approval({
      local: null,
      list: { protectionOff: false, keys: [OTHER] },
    });
    const request = await slice.requestAdd("h", "Laptop");
    expect(keyLog.map((k) => k.op)).toEqual(["get", "create"]);
    expect(log.map((l) => l.type)).toEqual(["approval.list"]);
    expect(decodeAdd(request.text)).toEqual({
      daemonId: "daemon-1",
      publicKey: KEY.publicKey,
      name: "Laptop",
    });
    expect(request.fingerprint).toBe(printOf(KEY.publicKey));
    expect(request.fingerprint).toMatch(/^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/);
  });

  test("a key the host does not list is the one waiting: it is reused, not replaced", async () => {
    const { slice, keyLog } = approval({ list: { protectionOff: false, keys: [OTHER] } });
    const request = await slice.requestAdd("h", "Laptop");
    expect(keyLog.map((k) => k.op)).toEqual(["get"]);
    expect(decodeAdd(request.text)?.publicKey).toBe(KEY.publicKey);
  });

  test("a name that an enrolled device would refuse makes no key", async () => {
    for (const name of ["", "  ", "x".repeat(65), "a\u202eb", "3f2a-91bc-07de-44a1"]) {
      const { slice, keyLog } = approval({ local: null });
      await expect(slice.requestAdd("h", name)).rejects.toThrow(t("approvalDevices.addBadName"));
      expect(keyLog.filter((k) => k.op === "create")).toEqual([]);
    }
  });

  test("a device the host already lists asks for nothing", async () => {
    const { slice, keyLog } = approval();
    await expect(slice.requestAdd("h", "Laptop")).rejects.toThrow(t("approvalDevices.hasKeyHere"));
    expect(keyLog.filter((k) => k.op === "create")).toEqual([]);
  });

  test("an enrolled device reads the text and names the key by its fingerprint, signing nothing", async () => {
    const { slice, log, keyLog } = approval();
    const offer = await slice.readAdd("h", text());
    expect(offer).toEqual({
      name: "Laptop",
      publicKey: NEW_KEY,
      // A literal, so a change to the rule shows here and not only on one side of a shared formula.
      fingerprint: "8492-e7ba-b6df-ae8a",
      host: "daemon-1",
    });
    expect(keyLog.filter((k) => k.op === "sign")).toEqual([]);
    expect(log.map((l) => l.type)).toEqual(["approval.list"]);
  });

  test("a text that is not fit to sign says why and signs nothing", async () => {
    const cases: Array<[string, string]> = [
      ["", t("approvalDevices.addBadText")],
      ["hello", t("approvalDevices.addBadText")],
      ["flightdeck-add:%%%", t("approvalDevices.addBadText")],
      [text({ publicKey: "AAAA" }), t("approvalDevices.addBadText")],
      [text({ name: "" }), t("approvalDevices.addBadText")],
      [text({ name: "a\u202eb" }), t("approvalDevices.addBadText")],
      [text({ name: "x".repeat(65) }), t("approvalDevices.addBadText")],
      [text({ name: "a\u200bb" }), t("approvalDevices.addBadText")],
      [text({ name: "3f2a-91bc-07de-44a1" }), t("approvalDevices.addBadText")],
      [text({ name: "3F2A91BC07DE44A1" }), t("approvalDevices.addBadText")],
      [text({ name: "Laptop 3f2a-91bc-07de-44a1" }), t("approvalDevices.addBadText")],
      [text({ name: "Laptop 3f2a.91bc.07de.44a1" }), t("approvalDevices.addBadText")],
      [text({ name: "a\u00a0b" }), t("approvalDevices.addBadText")],
      [text({ name: "a\ue000b" }), t("approvalDevices.addBadText")],
      [text({ publicKey: NEW_KEY.replace(/=+$/, "") }), t("approvalDevices.addBadText")],
      [text({ daemonId: "daemon-2" }), t("approvalDevices.addOtherHost")],
      [text({ publicKey: OTHER_PUBLIC }), t("approvalDevices.addAlready")],
    ];
    for (const [input, message] of cases) {
      const { slice, keyLog } = approval({
        list: {
          protectionOff: false,
          keys: [THIS, { ...OTHER, keyId: shaBytes(Buffer.from(OTHER_PUBLIC, "base64")) }],
        },
      });
      await expect(slice.readAdd("h", input)).rejects.toThrow(message);
      expect(keyLog.filter((k) => k.op === "sign")).toEqual([]);
    }
  });

  test("a device with no key here reads nothing", async () => {
    const { slice } = approval({ local: null });
    await expect(slice.readAdd("h", text())).rejects.toThrow(t("approvalDevices.noKeyHere"));
  });

  test("confirming signs the add of that key with this device's key and sends it beside the signer", async () => {
    const { slice, log } = approval();
    const offer = await slice.readAdd("h", text());
    log.length = 0;
    expect(await slice.confirmAdd("h", offer)).toBe("done");
    const message = enrollAddMessage({
      keyId: "key-this",
      daemonId: "daemon-1",
      nonce: "nonce-1",
      newPublicKey: NEW_KEY,
    });
    expect(log[0]).toEqual({ type: "approval.challenge", payload: { purpose: "enroll" } });
    expect(log[1]).toEqual({
      type: "approval.enroll",
      payload: {
        publicKey: NEW_KEY,
        name: "Laptop",
        nonce: "nonce-1",
        signature: `sig:${message}`,
        signerKeyId: "key-this",
      },
    });
  });

  test("a declined dialog sends nothing", async () => {
    const { slice, log } = approval({ signFails: "declined" });
    const offer = await slice.readAdd("h", text());
    log.length = 0;
    expect(await slice.confirmAdd("h", offer)).toBe("declined");
    expect(log.map((l) => l.type)).toEqual(["approval.challenge"]);
  });

  test("a host that refuses the add is an error, and this device keeps its own key", async () => {
    const { slice, keyLog } = approval({ refuse: "approval.enroll" });
    const offer = await slice.readAdd("h", text());
    await expect(slice.confirmAdd("h", offer)).rejects.toThrow();
    expect(keyLog.filter((k) => k.op === "delete")).toEqual([]);
  });

  test("a device with no key signs no add", async () => {
    const { slice, keyLog } = approval({ local: null });
    await expect(
      slice.confirmAdd("h", {
        name: "Laptop",
        publicKey: NEW_KEY,
        fingerprint: "x",
        host: "daemon-1",
      }),
    ).rejects.toThrow(t("approvalDevices.noKeyHere"));
    expect(keyLog.filter((k) => k.op === "sign")).toEqual([]);
  });
});

const ENROLLED = (keyId: string, name: string) =>
  ({
    type: "approval.enrolled",
    keyId,
    name,
    client: "app",
    address: "a",
    enrolledAt: "x",
  }) as const;

describe("approval: what a host announces about its devices (#3477)", () => {
  test("a device this one did not make is an alert that names it and the host", async () => {
    const { slice, notices } = approval();
    await slice.onChange("h", ENROLLED("key-new", "Unknown tablet"));
    expect(notices).toHaveLength(1);
    expect(notices[0]?.kind).toBe("fail");
    expect(notices[0]?.text).toContain("Unknown tablet");
    expect(notices[0]?.text).toContain("pi");
  });

  test("this device's own enrollment raises nothing, and a watching page is told only to read the list again", async () => {
    const { slice, notices } = approval();
    const heard: unknown[] = [];
    slice.subscribe("h", (change) => heard.push(change));
    await slice.onChange("h", ENROLLED("key-this", "Phone"));
    expect(notices).toEqual([]);
    expect(heard).toEqual([{ kind: "enrolled", name: "Phone", own: true }]);
  });

  test("a device this app is adding is not news to the person who just agreed to add it", async () => {
    const newId = createHash("sha256").update(Buffer.from(NEW_KEY, "base64")).digest("hex");
    const { slice, notices } = approval({
      onEnroll: (s) => s.onChange("h", ENROLLED(newId, "Laptop")),
    });
    const heard: unknown[] = [];
    slice.subscribe("h", (change) => heard.push(change));
    const offer = await slice.readAdd(
      "h",
      encodeAdd({ daemonId: "daemon-1", publicKey: NEW_KEY, name: "Laptop" }),
    );
    await slice.confirmAdd("h", offer);
    expect(notices).toEqual([]);
    expect(heard).toEqual([{ kind: "enrolled", name: "Laptop", own: true }]);
  });

  test("a page that watches the host gets the change and the app raises no notice of its own", async () => {
    const { slice, notices } = approval();
    const heard: unknown[] = [];
    slice.subscribe("h", (change) => heard.push(change));
    await slice.onChange("h", ENROLLED("key-new", "Unknown tablet"));
    expect(heard).toEqual([{ kind: "enrolled", name: "Unknown tablet", own: false }]);
    expect(notices).toEqual([]);
  });

  test("a page that stopped watching gets nothing", async () => {
    const { slice, notices } = approval();
    let heard = 0;
    slice.subscribe("h", () => heard++)();
    await slice.onChange("h", ENROLLED("key-new", "Unknown tablet"));
    expect(heard).toBe(0);
    expect(notices).toHaveLength(1);
  });

  test("another device revoked this device's key: an alert that says so", async () => {
    const { slice, notices } = approval();
    await slice.onChange("h", { type: "approval.revoked", keyId: "key-this" });
    expect(notices).toHaveLength(1);
    expect(notices[0]?.kind).toBe("fail");
    expect(notices[0]?.text).toContain("This device");
  });

  test("another device's key revoked is a quiet notice", async () => {
    const { slice, notices } = approval();
    await slice.onChange("h", { type: "approval.revoked", keyId: "key-other" });
    expect(notices).toHaveLength(1);
    expect(notices[0]?.kind).toBe("success");
  });

  test("a revoke this app is making is not announced back to the person", async () => {
    const { slice, notices } = approval({ onRevoke: (s) => s.onChange("h", REVOKED_OTHER) });
    await slice.revoke("h", "key-other");
    expect(notices).toEqual([]);
  });

  test("a host without a key store here still announces: no key is this device's", async () => {
    const { slice, notices } = approval({ keys: "none" });
    await slice.onChange("h", ENROLLED("key-this", "Phone"));
    expect(notices.map((n) => n.kind)).toEqual(["fail"]);
  });
});

const REVOKED_OTHER = { type: "approval.revoked", keyId: "key-other" } as const;

describe("approval: the proof of a prod or high-risk secret use (#3452)", () => {
  const VAULT_HOST = [FEATURE_APPROVAL_PROOF, FEATURE_APPROVAL_VAULT];

  test("a host that checks it gets a proof over the request and the scope, from a challenge asked for that request", async () => {
    const { slice, log, keyLog } = approval({ features: VAULT_HOST });
    const result = await slice.proveVault("h", "act-1", "once");
    const message = vaultApproveMessage({
      keyId: "key-this",
      daemonId: "daemon-1",
      requestId: "act-1",
      nonce: "nonce-1",
      scope: "once",
    });
    expect(result).toEqual({
      kind: "proof",
      proof: { keyId: "key-this", nonce: "nonce-1", signature: `sig:${message}` },
    });
    expect(log.map((l) => l.type)).toEqual(["approval.list", "approval.challenge"]);
    expect(log[1]?.payload).toEqual({ purpose: "approve", requestId: "act-1" });
    expect(keyLog.find((k) => k.op === "sign")?.args).toEqual(["daemon-1", message, "en"]);
  });

  test("the scope is in what is signed", async () => {
    const { slice, keyLog } = approval({ features: VAULT_HOST });
    await slice.proveVault("h", "act-1", "session");
    expect(String(keyLog.find((k) => k.op === "sign")?.args[1])).toContain('"session"');
  });

  test("a host that does not announce the vault proof, has no key enrolled, or an app with no key port gets none", async () => {
    for (const setup of [
      approval({ features: [FEATURE_APPROVAL_PROOF] }),
      approval({ features: VAULT_HOST, keys: "none" }),
      approval({ features: VAULT_HOST, list: { protectionOff: true, keys: [] } }),
    ]) {
      expect(await setup.slice.proveVault("h", "act-1", "once")).toEqual({ kind: "none" });
      expect(setup.keyLog.filter((k) => k.op === "sign")).toEqual([]);
    }
  });

  test("when the person declines the system's dialog, nothing is sent and no error is raised", async () => {
    const { slice, keyLog } = approval({ features: VAULT_HOST, signFails: "declined" });
    expect(await slice.proveVault("h", "act-1", "once")).toEqual({ kind: "declined" });
    // The dialog was shown (the decline is the person's, not a skipped step).
    expect(keyLog.filter((k) => k.op === "sign")).toHaveLength(1);
  });

  test("a device with no key for this host is told so, in words", async () => {
    const { slice } = approval({ features: VAULT_HOST, local: null });
    await expect(slice.proveVault("h", "act-1", "once")).rejects.toThrow(
      t("approvalDevices.noKeyHere"),
    );
  });
});

describe("approval: the proof of a command that moves code or trust (#3453)", () => {
  const COMMAND_HOST = [FEATURE_APPROVAL_PROOF, FEATURE_APPROVAL_COMMAND];
  const PR = "https://github.com/acme/repo/pull/9";
  const MERGE = {
    cardId: "c1",
    method: "squash",
    confirm: true,
    prUrl: PR,
    headSha: "a".repeat(40),
  };

  test("a host that checks it gets a proof over the command and a hash of the payload, which the shell also gets", async () => {
    const { slice, log, keyLog } = approval({ features: COMMAND_HOST });
    const result = await slice.proveCommand("h", "card.pr.merge", MERGE);
    const digest = commandDigest(MERGE);
    const message = commandMessage({
      keyId: "key-this",
      daemonId: "daemon-1",
      command: "card.pr.merge",
      nonce: "nonce-1",
      payloadHash: sha(digest),
    });
    expect(result).toEqual({
      kind: "proof",
      proof: { keyId: "key-this", nonce: "nonce-1", signature: `sig:${message}` },
    });
    expect(log.map((l) => l.type)).toEqual(["approval.list", "approval.challenge"]);
    expect(log[1]?.payload).toEqual({ purpose: "command", command: "card.pr.merge" });
    expect(keyLog.find((k) => k.op === "sign")?.args).toEqual(["daemon-1", message, "en", digest]);
  });

  test("a host that does not announce it, has no key enrolled, or an app with no key port gets none", async () => {
    for (const setup of [
      approval({ features: [FEATURE_APPROVAL_PROOF] }),
      approval({ features: COMMAND_HOST, keys: "none" }),
      approval({ features: COMMAND_HOST, list: { protectionOff: true, keys: [] } }),
    ]) {
      expect(await setup.slice.proveCommand("h", "card.pr.merge", MERGE)).toEqual({ kind: "none" });
      expect(setup.keyLog.filter((k) => k.op === "sign")).toEqual([]);
    }
  });

  test("a no in the system's dialog is a decline, and a device with no key for this host is told so", async () => {
    const declined = approval({ features: COMMAND_HOST, signFails: "declined" });
    expect(await declined.slice.proveCommand("h", "card.pr.merge", MERGE)).toEqual({
      kind: "declined",
    });
    const keyless = approval({ features: COMMAND_HOST, local: null });
    await expect(keyless.slice.proveCommand("h", "card.pr.merge", MERGE)).rejects.toThrow(
      t("approvalDevices.noKeyHere"),
    );
  });

  test("a merge payload names the head read now, carries the proof, and is a payload the host accepts as sent", async () => {
    const { slice, log } = approval({ features: COMMAND_HOST });
    const made = await slice.mergePayload("h", "c1", "squash");
    expect(made.kind).toBe("payload");
    const payload = made.kind === "payload" ? made.payload : {};
    const { proof, ...bound } = payload as typeof MERGE & { proof: unknown };
    expect(bound).toEqual(MERGE);
    expect(proof).toEqual({
      keyId: "key-this",
      nonce: "nonce-1",
      signature: expect.stringContaining("sig:"),
    });
    expect(log.map((l) => l.type)).toEqual(["card.pr.head", "approval.list", "approval.challenge"]);
    expect(Command.safeParse({ id: "1", type: "card.pr.merge", payload }).success).toBe(true);
  });

  test("the proof is over the very payload that is sent, minus the proof", async () => {
    const { slice, keyLog } = approval({ features: COMMAND_HOST });
    await slice.mergePayload("h", "c1", "merge");
    const sign = keyLog.find((k) => k.op === "sign");
    expect(sign?.args[3]).toBe(commandDigest({ ...MERGE, method: "merge" }));
  });

  test("a host with no key enrolled still gets the head bound, and no challenge", async () => {
    const { slice, log } = approval({
      features: COMMAND_HOST,
      list: { protectionOff: true, keys: [] },
    });
    expect(await slice.mergePayload("h", "c1", "merge")).toEqual({
      kind: "payload",
      payload: { ...MERGE, method: "merge" },
    });
    expect(log.map((l) => l.type)).toEqual(["card.pr.head", "approval.list"]);
  });

  test("a host from before the feature gets the plain payload and is asked nothing else", async () => {
    const { slice, log } = approval({ features: [FEATURE_APPROVAL_PROOF] });
    expect(await slice.mergePayload("h", "c1", "merge")).toEqual({
      kind: "payload",
      payload: { cardId: "c1", method: "merge", confirm: true },
    });
    expect(log).toEqual([]);
  });

  test("a no from the person stops the merge, and a head that cannot be read is an error", async () => {
    const declined = approval({ features: COMMAND_HOST, signFails: "declined" });
    expect(await declined.slice.mergePayload("h", "c1", "merge")).toEqual({ kind: "declined" });
    const unreadable = approval({ features: COMMAND_HOST, refuse: "card.pr.head" });
    await expect(unreadable.slice.mergePayload("h", "c1", "merge")).rejects.toThrow();
  });

  const BYPASS_HOST = [FEATURE_APPROVAL_PROOF, FEATURE_APPROVAL_COMMAND, FEATURE_APPROVAL_BYPASS];
  const ON = { allow: true, confirm: true } as const;

  test("turning bypass on carries the proof over exactly {allow, confirm}, signed with this device's key (#3507)", async () => {
    const { slice, log, keyLog } = approval({ features: BYPASS_HOST });
    const made = await slice.bypassPayload("h");
    const payload = made.kind === "payload" ? made.payload : {};
    const { proof, ...bound } = payload as typeof ON & { proof: unknown };
    expect(bound).toEqual(ON);
    expect(proof).toEqual({
      keyId: "key-this",
      nonce: "nonce-1",
      signature: expect.stringContaining("sig:"),
    });
    expect(log.map((l) => l.type)).toEqual(["approval.list", "approval.challenge"]);
    expect(log[1]?.payload).toEqual({ purpose: "command", command: "host.bypass" });
    expect(keyLog.find((k) => k.op === "sign")?.args[3]).toBe(commandDigest(ON));
    expect(Command.safeParse({ id: "1", type: "host.bypass", payload }).success).toBe(true);
  });

  test("a host that announces the merge proof but not the bypass one gets the plain payload and no challenge", async () => {
    const { slice, log } = approval({ features: COMMAND_HOST });
    expect(await slice.bypassPayload("h")).toEqual({ kind: "payload", payload: ON });
    expect(log).toEqual([]);
  });

  test("a host with no device enrolled gets the plain payload; a no in the dialog stops it; a device with no key here is told so", async () => {
    const off = approval({ features: BYPASS_HOST, list: { protectionOff: true, keys: [] } });
    expect(await off.slice.bypassPayload("h")).toEqual({ kind: "payload", payload: ON });
    const declined = approval({ features: BYPASS_HOST, signFails: "declined" });
    expect(await declined.slice.bypassPayload("h")).toEqual({ kind: "declined" });
    const keyless = approval({ features: BYPASS_HOST, local: null });
    await expect(keyless.slice.bypassPayload("h")).rejects.toThrow(t("approvalDevices.noKeyHere"));
  });

  test("a host that checks proofs but not a command is one the app says so of, for each command; one that checks all, or one not known, is not", () => {
    const unchecked = (features: string[]) => approval({ features }).slice.uncheckedCommands("h");
    expect(unchecked([FEATURE_APPROVAL_PROOF])).toEqual(["merge", "trust", "bypass", "resume"]);
    expect(unchecked(COMMAND_HOST)).toEqual(["trust", "bypass", "resume"]);
    expect(unchecked([FEATURE_APPROVAL_PROOF, FEATURE_APPROVAL_TRUST])).toEqual([
      "merge",
      "bypass",
      "resume",
    ]);
    expect(unchecked([...COMMAND_HOST, FEATURE_APPROVAL_TRUST])).toEqual(["bypass", "resume"]);
    expect(unchecked([...COMMAND_HOST, FEATURE_APPROVAL_TRUST, FEATURE_APPROVAL_BYPASS])).toEqual([
      "resume",
    ]);
    expect(
      unchecked([
        ...COMMAND_HOST,
        FEATURE_APPROVAL_TRUST,
        FEATURE_APPROVAL_BYPASS,
        FEATURE_APPROVAL_RESUME,
      ]),
    ).toEqual([]);
    expect(unchecked([])).toEqual([]);
  });

  const TRUST_HOST = [FEATURE_APPROVAL_PROOF, FEATURE_APPROVAL_TRUST];
  const TRUST = { path: "/work/api", trusted: true };

  test("trusting a folder on a host that checks it is signed over the folder, in the dialog that names it", async () => {
    const { slice, log, keyLog } = approval({ features: TRUST_HOST });
    const made = await slice.trustPayload("h", "/work/api");
    const digest = commandDigest(TRUST);
    const message = commandMessage({
      keyId: "key-this",
      daemonId: "daemon-1",
      command: "project.trust.set",
      nonce: "nonce-1",
      payloadHash: sha(digest),
    });
    expect(made).toEqual({
      kind: "payload",
      payload: {
        ...TRUST,
        proof: { keyId: "key-this", nonce: "nonce-1", signature: `sig:${message}` },
      },
    });
    expect(log[1]?.payload).toEqual({ purpose: "command", command: "project.trust.set" });
    expect(keyLog.find((k) => k.op === "sign")?.args).toEqual(["daemon-1", message, "en", digest]);
    expect(
      Command.safeParse({
        id: "1",
        type: "project.trust.set",
        payload: made.kind === "payload" ? made.payload : {},
      }).success,
    ).toBe(true);
  });

  test("a host that does not announce the trust proof, or has no device enrolled, gets the plain payload and is asked for no signature", async () => {
    for (const setup of [
      approval({ features: COMMAND_HOST }),
      approval({ features: TRUST_HOST, list: { protectionOff: true, keys: [] } }),
      approval({ features: TRUST_HOST, keys: "none" }),
    ]) {
      expect(await setup.slice.trustPayload("h", "/work/api")).toEqual({
        kind: "payload",
        payload: TRUST,
      });
      expect(setup.keyLog.filter((k) => k.op === "sign")).toEqual([]);
    }
  });

  test("a no in the dialog of a trust sends nothing, and a device with no key for this host is told so", async () => {
    const declined = approval({ features: TRUST_HOST, signFails: "declined" });
    expect(await declined.slice.trustPayload("h", "/work/api")).toEqual({ kind: "declined" });
    const keyless = approval({ features: TRUST_HOST, local: null });
    await expect(keyless.slice.trustPayload("h", "/work/api")).rejects.toThrow(
      t("approvalDevices.noKeyHere"),
    );
  });
  const RESUME_HOST = [FEATURE_APPROVAL_PROOF, FEATURE_APPROVAL_RESUME];
  const RESUME = { sessionKey: "card:c1", confirm: true };

  test("resuming a session on a host that checks it is signed over the session, in the dialog that names it", async () => {
    const { slice, log, keyLog } = approval({ features: RESUME_HOST });
    const made = await slice.resumePayload("h", "card:c1");
    const digest = commandDigest(RESUME);
    const message = commandMessage({
      keyId: "key-this",
      daemonId: "daemon-1",
      command: "autoapprove.resume",
      nonce: "nonce-1",
      payloadHash: sha(digest),
    });
    expect(made).toEqual({
      kind: "payload",
      payload: {
        ...RESUME,
        proof: { keyId: "key-this", nonce: "nonce-1", signature: `sig:${message}` },
      },
    });
    expect(log[1]?.payload).toEqual({ purpose: "command", command: "autoapprove.resume" });
    expect(keyLog.find((k) => k.op === "sign")?.args).toEqual(["daemon-1", message, "en", digest]);
    expect(
      Command.safeParse({
        id: "1",
        type: "autoapprove.resume",
        payload: made.kind === "payload" ? made.payload : {},
      }).success,
    ).toBe(true);
  });

  test("a host that does not announce the resume proof, or has no device enrolled, gets the plain payload and is asked for no signature", async () => {
    for (const setup of [
      approval({ features: COMMAND_HOST }),
      approval({ features: RESUME_HOST, list: { protectionOff: true, keys: [] } }),
      approval({ features: RESUME_HOST, keys: "none" }),
    ]) {
      expect(await setup.slice.resumePayload("h", "card:c1")).toEqual({
        kind: "payload",
        payload: RESUME,
      });
      expect(setup.keyLog.filter((k) => k.op === "sign")).toEqual([]);
    }
  });

  test("a no in the dialog of a resume sends nothing, and a device with no key for this host is told so", async () => {
    const declined = approval({ features: RESUME_HOST, signFails: "declined" });
    expect(await declined.slice.resumePayload("h", "card:c1")).toEqual({ kind: "declined" });
    const keyless = approval({ features: RESUME_HOST, local: null });
    await expect(keyless.slice.resumePayload("h", "card:c1")).rejects.toThrow(
      t("approvalDevices.noKeyHere"),
    );
  });
});
