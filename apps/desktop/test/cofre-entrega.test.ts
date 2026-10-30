import { describe, expect, test } from "bun:test";
import type { VaultRequestFrame } from "@flightdeck/protocol";
import type { SecretMeta } from "../src/lib/vault.ts";
import {
  type AnswerDeps,
  answerVaultRequest,
  transportAllowed,
} from "../src/lib/vault-requests.ts";

const SECRET: SecretMeta = {
  id: "s1",
  name: "deploy",
  type: "token",
  description: "",
  tags: [],
  createdAt: 1,
  lastUsedAt: null,
  allowedHosts: ["h1"],
};
const VALUE = "entrega-test-value-456";
const REQUEST: VaultRequestFrame = {
  type: "vault.request",
  requestId: "r1",
  secretId: "s1",
  purpose: "ssh",
  requester: "claude",
};

/** A policy that delivers, the seam phase 17 fills; the deliveries land in `delivered`. */
function setup(overrides: Partial<AnswerDeps> = {}) {
  const delivered: unknown[] = [];
  const reads: string[] = [];
  const deps: AnswerDeps = {
    hostId: "h1",
    hostUrl: "ws://127.0.0.1:7878/",
    vault: {
      list: () => [SECRET],
      value: async (id) => {
        reads.push(id);
        return VALUE;
      },
    },
    policy: () => ({ kind: "deliver" }),
    deliver: async (payload) => {
      delivered.push(payload);
      return { expiresAt: payload.expiresAt };
    },
    now: () => 1_000,
    ...overrides,
  };
  return { deps, delivered, reads };
}

describe("cofre-entrega", () => {
  test("a delivering policy sends vault.deliver with the value, the purpose, the requester and a 60 s deadline", async () => {
    const { deps, delivered } = setup();
    const outcome = await answerVaultRequest(REQUEST, deps);
    expect(delivered).toEqual([
      { secretId: "s1", value: VALUE, purpose: "ssh", expiresAt: 61_000, requester: "claude" },
    ]);
    expect(outcome).toEqual({
      hostId: "h1",
      secretId: "s1",
      purpose: "ssh",
      requester: "claude",
      delivered: true,
      reason: "",
    });
    expect(JSON.stringify(outcome).includes(VALUE)).toBe(false);
  });

  test("a host outside the secret's allowed hosts is refused before the value is read", async () => {
    const { deps, delivered, reads } = setup({ hostId: "h2" });
    const outcome = await answerVaultRequest(REQUEST, deps);
    expect(outcome.delivered).toBe(false);
    expect(outcome.reason).toBe("the secret is not allowed for this host");
    expect(delivered).toEqual([]);
    expect(reads).toEqual([]);
  });

  test("a secret the vault does not have is refused", async () => {
    const { deps, delivered } = setup({ vault: { list: () => [], value: async () => VALUE } });
    const outcome = await answerVaultRequest(REQUEST, deps);
    expect(outcome.delivered).toBe(false);
    expect(outcome.reason).toBe("the vault has no such secret");
    expect(delivered).toEqual([]);
  });

  test("a connection that is not loopback or Tailscale is refused with the reason, before the value is read", async () => {
    const { deps, delivered, reads } = setup({ hostUrl: "ws://192.168.1.20:7878/" });
    const outcome = await answerVaultRequest(REQUEST, deps);
    expect(outcome.delivered).toBe(false);
    expect(outcome.reason).toBe(
      "the vault only delivers over loopback or Tailscale, which WireGuard encrypts",
    );
    expect(delivered).toEqual([]);
    expect(reads).toEqual([]);
  });

  test("an entry whose value is gone from the keyring is refused", async () => {
    const { deps, delivered } = setup({ vault: { list: () => [SECRET], value: async () => null } });
    const outcome = await answerVaultRequest(REQUEST, deps);
    expect(outcome.delivered).toBe(false);
    expect(outcome.reason).toBe("the secret's value is missing from the system vault");
    expect(delivered).toEqual([]);
  });

  test("a delivery the daemon refuses is reported with its message, which never carries the value", async () => {
    const { deps } = setup({
      deliver: async () => {
        throw new Error("daemon says no");
      },
    });
    const outcome = await answerVaultRequest(REQUEST, deps);
    expect(outcome.delivered).toBe(false);
    expect(outcome.reason).toBe("delivery failed: daemon says no");
  });

  test("only loopback and the Tailscale ranges are an accepted transport", () => {
    const accepted = [
      "ws://127.0.0.1:7878/",
      "ws://127.5.6.7/",
      "ws://localhost:1/",
      "ws://[::1]:7878/",
      "ws://100.64.0.1:7878/",
      "ws://100.127.255.254/",
      "ws://[fd7a:115c:a1e0:ab12::1]:7878/",
    ];
    const refused = [
      "ws://192.168.1.20:7878/",
      "ws://10.0.0.5/",
      "ws://100.63.255.255/",
      "ws://100.128.0.1/",
      "ws://[fd7a:115c:a1e1::1]/",
      "ws://example.com/",
      "wss://example.com/",
      "not a url",
      "",
    ];
    expect(accepted.map(transportAllowed)).toEqual(accepted.map(() => true));
    expect(refused.map(transportAllowed)).toEqual(refused.map(() => false));
  });
});
