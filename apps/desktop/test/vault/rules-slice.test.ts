import { describe, expect, test } from "bun:test";
import type { VaultVerdict } from "@flightdeck/protocol";
import { type VaultRulesCore, VaultRulesSlice } from "../../src/features/vault/index.ts";
import type { SecretMeta } from "../../src/features/vault/vault.ts";

const ALLOW = [{ id: "r1", decision: "allow" }];
const ASK = [{ id: "r2", decision: "ask" }];
const SECRET = { id: "s1", name: "deploy", tags: ["ci"], allowedHosts: ["a", "b"] } as SecretMeta;
const verdict = (reason: string): VaultVerdict => ({
  decision: "allow",
  ruleId: null,
  reason,
  once: false,
  needsHold: false,
  limited: false,
});
const hosts = (...status: string[]) =>
  status.map((s, i) => ({ id: String.fromCharCode(97 + i), name: `host-${i}`, status: s }));

/**
 * A slice over stand-ins: `refuse` names the hosts that refuse `vault.rules.set`, `held` is what a
 * host answers to `vault.rules.get`; every command sent is written down as `host type`.
 */
function slice(
  over: { status?: string[]; refuse?: string[]; held?: Record<string, unknown[]> } = {},
) {
  const saved: Record<string, unknown[]> = { s1: ASK };
  const sent: Array<{ host: string; type: string; rules?: unknown[] }> = [];
  const events: string[] = [];
  const core: VaultRulesCore = {
    rules: {
      get: (id) => saved[id] ?? [],
      set: (id, rules) => {
        saved[id] = rules;
      },
      all: () => saved,
    },
    secrets: () => [SECRET],
    hosts: () => hosts(...(over.status ?? ["online", "online"])),
    clients: () => [],
    projectKeysOf: () => [],
    secretsChanged: () => {
      events.push("secrets");
    },
    request: (async (hostId: string, type: string, payload: { rules?: unknown[] }) => {
      sent.push({ host: hostId, type, rules: payload.rules });
      if (over.refuse?.includes(hostId)) {
        return { ok: false, code: "refused", message: `${hostId} says no` };
      }
      return { ok: true, data: { rules: over.held?.[hostId] ?? [] } };
    }) as VaultRulesCore["request"],
    preview: async (hostId) => verdict(hostId),
    fail: (error, text) => {
      events.push(`fail ${(error as Error).message} ${text ?? ""}`.trim());
    },
    success: (text) => {
      events.push(`success ${text}`);
    },
    t: () => ((key: string) => key) as never,
  };
  return { rules: new VaultRulesSlice(core), saved, sent, events };
}

describe("vault rules slice: a secret's usage rules", () => {
  test("set hands the rules to each online host the secret may go to, saves them and tells the screens", async () => {
    const s = slice({ status: ["online", "offline"] });
    expect(await s.rules.set("s1", ALLOW)).toEqual({ ok: true });
    expect(s.sent).toEqual([{ host: "a", type: "vault.rules.set", rules: ALLOW }]);
    expect(s.rules.get("s1")).toEqual(ALLOW);
    expect(s.events).toEqual(["secrets"]);
  });

  test("a refusal puts back the hosts that accepted, saves nothing and comes back with the reason", async () => {
    const s = slice({ refuse: ["b"] });
    const result = await s.rules.set("s1", ALLOW);
    expect(result).toEqual({ ok: false, code: "refused", message: "b says no" });
    // Host a took the new rules, then went back to the saved ones; host b refused the new ones.
    expect(s.sent.map((x) => `${x.host} ${JSON.stringify(x.rules)}`)).toEqual([
      `a ${JSON.stringify(ALLOW)}`,
      `b ${JSON.stringify(ALLOW)}`,
      `a ${JSON.stringify(ASK)}`,
    ]);
    expect(s.rules.get("s1")).toEqual(ASK);
    expect(s.events).toEqual([]);
  });

  test("readHost gives what a host holds without the rules a client generated, and null when it does not answer", async () => {
    const generated = { id: "client-scope:c1:x", decision: "deny" };
    const own = slice({ held: { a: [generated, ...ALLOW] } });
    expect(await own.rules.readHost("a", "s1")).toEqual(ALLOW);
    const refused = slice({ refuse: ["a"] });
    expect(await refused.rules.readHost("a", "s1")).toBeNull();
  });

  test("preview asks the first online host the secret may go to, and nothing when there is none", async () => {
    const s = slice({ status: ["offline", "online"] });
    expect(await s.rules.preview("s1", { action: "deploy" } as never)).toEqual(verdict("b"));
    expect(await s.rules.preview("unknown", {} as never)).toBeNull();
    expect(
      await slice({ status: ["offline", "offline"] }).rules.preview("s1", {} as never),
    ).toBeNull();
  });

  test("onConnect sends a host the rules of the secrets it may receive, and of no other", async () => {
    const s = slice();
    const asked: Array<{ type: string; payload: unknown }> = [];
    const conn = {
      request: async (type: string, payload: unknown) => {
        asked.push({ type, payload });
        return { rules: [] };
      },
    };
    s.rules.onConnect("a", conn as never);
    s.rules.onConnect("c", conn as never);
    await Promise.resolve();
    expect(asked).toEqual([
      { type: "vault.rules.set", payload: { secretId: "s1", tags: ["ci"], rules: ASK } },
    ]);
  });
});
