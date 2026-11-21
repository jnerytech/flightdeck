import { describe, expect, test } from "bun:test";
import type { ApprovalProof } from "@flightdeck/protocol";
import { type VaultRulesCore, VaultRulesSlice } from "../../src/features/vault/index.ts";
import type { SecretMeta } from "../../src/features/vault/vault.ts";

/**
 * Issue #3754: a host with a device enrolled takes a set of rules that loosens only with the device's signed
 * proof. The app asks for the signature once per host when the person saves (or when a refused save is put
 * back), asks for none when the rules only tighten, and shows every refusal: it never falls back silently to
 * the looser set and never asks again on its own.
 */
const ALLOW = [{ id: "r1", decision: "allow" }];
const ASK = [{ id: "r2", decision: "ask" }];
const DENY = [{ id: "r3", decision: "deny", outsideWindow: "deny" }];
const SECRET = { id: "s1", name: "deploy", tags: ["ci"], allowedHosts: ["a", "b"] } as SecretMeta;
const PROOF: ApprovalProof = { keyId: "k1", nonce: "n1", signature: "c2ln" };

type Proved = { kind: "none" } | { kind: "proof"; proof: ApprovalProof } | { kind: "declined" };

/**
 * A slice over stand-ins. `saved` is what the app keeps, `answers` what each host's device does when asked
 * to sign (a host with no entry has no device: nothing to prove), `refuse` the hosts that refuse the set.
 * `asked` lists the signatures asked for as `host rule ids`; `sent` every command as `host ids proof?`.
 */
function slice(
  over: {
    saved?: unknown[];
    answers?: Record<string, Proved>;
    refuse?: string[];
    /** Refuses one send, named as `sent` writes it without the proof mark: `host rule ids`. */
    refuseSend?: string[];
  } = {},
) {
  const saved: Record<string, unknown[]> = { s1: over.saved ?? ASK };
  const asked: string[] = [];
  const sent: string[] = [];
  const events: string[] = [];
  const idsOf = (rules: unknown) => (rules as Array<{ id: string }>).map((r) => r.id).join(",");
  const core: VaultRulesCore = {
    rules: {
      get: (id) => saved[id] ?? [],
      set: (id, rules) => {
        saved[id] = rules;
      },
      all: () => saved,
    },
    secrets: () => [SECRET],
    hosts: () => [
      { id: "a", name: "host-a", status: "online" },
      { id: "b", name: "host-b", status: "online" },
    ],
    clients: () => [],
    projectKeysOf: () => [],
    secretsChanged: () => {},
    proveRules: async (hostId, payload) => {
      asked.push(`${hostId} ${idsOf(payload.rules)}`);
      return over.answers?.[hostId] ?? { kind: "none" };
    },
    request: (async (
      hostId: string,
      type: string,
      payload: { rules?: unknown[]; proof?: unknown },
    ) => {
      sent.push(`${hostId} ${idsOf(payload.rules)}${payload.proof ? " proof" : ""}`);
      const line = `${hostId} ${idsOf(payload.rules)}`;
      if (
        type === "vault.rules.set" &&
        (over.refuse?.includes(hostId) || over.refuseSend?.includes(line))
      ) {
        return { ok: false, code: "refused", message: `${hostId} says no` };
      }
      return { ok: true, data: { rules: [] } };
    }) as VaultRulesCore["request"],
    preview: async () => {
      throw new Error("not used");
    },
    fail: (error, text) => {
      events.push(`fail ${(error as Error).message} ${text ?? ""}`.trim());
    },
    success: () => {},
    t: () => ((key: string) => key) as never,
  };
  return { rules: new VaultRulesSlice(core), saved, asked, sent, events };
}

describe("vault rules proof: saving rules that loosen asks the device to sign them (#3754)", () => {
  test("rules with an allow are signed per host and each host gets its own proof", async () => {
    const s = slice({
      answers: { a: { kind: "proof", proof: PROOF }, b: { kind: "proof", proof: PROOF } },
    });
    expect(await s.rules.set("s1", ALLOW)).toEqual({ ok: true });
    expect({ asked: s.asked, sent: s.sent }).toEqual({
      asked: ["a r1", "b r1"],
      sent: ["a r1 proof", "b r1 proof"],
    });
  });

  test("an outsideWindow of allow is signed too", async () => {
    const rules = [{ id: "r4", decision: "ask", outsideWindow: "allow" }];
    const s = slice({ answers: { a: { kind: "proof", proof: PROOF } } });
    await s.rules.set("s1", rules);
    expect(s.asked).toEqual(["a r4", "b r4"]);
  });

  test("rules that only ask or deny ask for no signature and carry no proof", async () => {
    const s = slice({ answers: { a: { kind: "proof", proof: PROOF } } });
    expect(await s.rules.set("s1", [...ASK, ...DENY])).toEqual({ ok: true });
    expect({ asked: s.asked, sent: s.sent }).toEqual({
      asked: [],
      sent: ["a r2,r3", "b r2,r3"],
    });
  });

  test("an empty set asks for no signature: clearing the rules is never held up", async () => {
    const s = slice();
    expect(await s.rules.set("s1", [])).toEqual({ ok: true });
    expect(s.asked).toEqual([]);
  });

  test("a host with no device (nothing to prove) gets the rules as they are", async () => {
    const s = slice();
    expect(await s.rules.set("s1", ALLOW)).toEqual({ ok: true });
    expect(s.sent).toEqual(["a r1", "b r1"]);
  });

  test("a person who declines the signature saves nothing and is told the host needs it", async () => {
    const s = slice({ answers: { a: { kind: "declined" } } });
    const result = await s.rules.set("s1", ALLOW);
    expect(result).toMatchObject({ ok: false, code: "approval_proof_required" });
    expect({ sent: s.sent, saved: s.rules.get("s1") }).toEqual({ sent: [], saved: ASK });
  });

  test("a decline on the second host puts the first back to the saved rules and keeps what is saved", async () => {
    const s = slice({
      answers: { a: { kind: "proof", proof: PROOF }, b: { kind: "declined" } },
    });
    const result = await s.rules.set("s1", ALLOW);
    expect(result).toMatchObject({ ok: false, code: "approval_proof_required" });
    expect({ sent: s.sent, saved: s.rules.get("s1") }).toEqual({
      sent: ["a r1 proof", "a r2"],
      saved: ASK,
    });
  });
});

describe("vault rules proof: putting a refused save back never goes quiet (#3754)", () => {
  test("the saved rules that allow are put back with a signature, asked once for the host", async () => {
    const s = slice({
      saved: ALLOW,
      answers: { a: { kind: "proof", proof: PROOF } },
      refuse: ["b"],
    });
    const result = await s.rules.set("s1", ASK);
    expect(result).toEqual({ ok: false, code: "refused", message: "b says no" });
    expect({ asked: s.asked, sent: s.sent, events: s.events }).toEqual({
      asked: ["a r1"],
      sent: ["a r2", "b r2", "a r1 proof"],
      events: [],
    });
  });

  test("a put back that is not signed is shown, the host keeps the tighter set, and nothing asks again", async () => {
    const s = slice({ saved: ALLOW, answers: { a: { kind: "declined" } }, refuse: ["b"] });
    const result = await s.rules.set("s1", ASK);
    expect(result).toEqual({ ok: false, code: "refused", message: "b says no" });
    expect({ asked: s.asked, sent: s.sent, events: s.events }).toEqual({
      asked: ["a r1"],
      sent: ["a r2", "b r2"],
      events: ["fail approval_proof_required vaultRulesUi.notPutBack"],
    });
  });

  test("a put back the host refuses is shown too, not dropped", async () => {
    const s = slice({
      saved: ALLOW,
      answers: { a: { kind: "proof", proof: PROOF } },
      refuse: ["b"],
      refuseSend: ["a r1"],
    });
    const result = await s.rules.set("s1", ASK);
    expect(result).toEqual({ ok: false, code: "refused", message: "b says no" });
    expect(s.events).toEqual(["fail refused vaultRulesUi.notPutBack"]);
  });
});

describe("vault rules proof: the resync on connect asks for no signature and shows a refusal (#3754)", () => {
  test("a host that refuses the rules that allow is told to the person, and no signature is asked", async () => {
    const s = slice({ saved: ALLOW, answers: { a: { kind: "proof", proof: PROOF } } });
    const conn = {
      request: async () => {
        throw new Error("approval_proof_required");
      },
    };
    s.rules.onConnect("a", conn as never);
    await Promise.resolve();
    await Promise.resolve();
    expect({ asked: s.asked, events: s.events }).toEqual({
      asked: [],
      events: ["fail approval_proof_required vaultRulesUi.notResent"],
    });
  });
});
