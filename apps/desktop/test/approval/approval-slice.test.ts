import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  approvalDigests,
  approvalMessage,
  enrollFirstMessage,
  FEATURE_APPROVAL_PROOF,
  type PermissionUpdate,
  revokeMessage,
} from "@flightdeck/protocol";
import { ApprovalSlice } from "../../src/features/approval/index.ts";
import { refusalText } from "../../src/i18n/errors.ts";
import { translator } from "../../src/i18n/index.ts";
import type { HostResult } from "../../src/lib/kernel.ts";

const t = translator("en");
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const KEY = { publicKey: "pub-this", keyId: "key-this" };
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
            get: async (id) => (keyLog.push({ op: "get", args: [id] }), local),
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
    expect(keyLog.map((k) => k.op)).toEqual(["create", "sign"]);
    expect(log.map((l) => l.type)).toEqual(["approval.challenge", "approval.enroll"]);
    expect(log[0]?.payload).toEqual({ purpose: "enroll" });
    expect(log[1]?.payload).toEqual({
      publicKey: KEY.publicKey,
      name: "My phone",
      nonce: "nonce-1",
      signature: `sig:${message}`,
      code: "the-code",
    });
  });

  test("a refused enrollment leaves no key on this device", async () => {
    const { slice, keyLog } = approval({ local: null, refuse: "approval.enroll" });
    await expect(slice.enroll("h", "My phone", "wrong")).rejects.toThrow();
    expect(keyLog.at(-1)).toEqual({ op: "delete", args: ["daemon-1"] });
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
