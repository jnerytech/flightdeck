import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  approvalDigests,
  approvalMessage,
  enrollAddMessage,
  enrollFirstMessage,
  FEATURE_APPROVAL_PROOF,
  type PermissionUpdate,
  revokeMessage,
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
  shaBytes(Buffer.from(publicKey, "base64")).slice(0, 16).replace(/(.{4})(?=.)/g, "$1-");
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
  } = {},
) {
  const log: Array<{ type: string; payload?: unknown }> = [];
  const keyLog: Array<{ op: string; args: unknown[] }> = [];
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
            sign: async (id, message, lang) => {
              keyLog.push({ op: "sign", args: [id, message, lang] });
              if (over.signFails) throw over.signFails;
              return `sig:${message}`;
            },
          },
    host: () => ({ features: over.features ?? [FEATURE_APPROVAL_PROOF], daemonId: "daemon-1" }),
    request: (async (_hostId: string, type: string, payload: unknown) => {
      log.push({ type, payload });
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
      };
      return { ok: true, data: data[type] };
    }) as never as () => Promise<HostResult<never>>,
    lang: () => "en",
    t: () => t,
  });
  return { slice, log, keyLog };
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
    const { slice, log, keyLog } = approval({ local: null, list: { protectionOff: false, keys: [OTHER] } });
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
      fingerprint: printOf(NEW_KEY),
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
      [text({ daemonId: "daemon-2" }), t("approvalDevices.addOtherHost")],
      [text({ publicKey: OTHER_PUBLIC }), t("approvalDevices.addAlready")],
    ];
    for (const [input, message] of cases) {
      const { slice, keyLog } = approval({
        list: { protectionOff: false, keys: [THIS, { ...OTHER, publicKey: OTHER_PUBLIC } as never] },
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
      slice.confirmAdd("h", { name: "Laptop", publicKey: NEW_KEY, fingerprint: "x", host: "daemon-1" }),
    ).rejects.toThrow(t("approvalDevices.noKeyHere"));
    expect(keyLog.filter((k) => k.op === "sign")).toEqual([]);
  });
});
