import { describe, expect, test } from "bun:test";
import type { VaultRequestFrame } from "@flightdeck/protocol";
import type { SecretMeta } from "../src/lib/vault.ts";
import { type AnswerDeps, answerVaultRequest, denyAllPolicy } from "../src/lib/vault-requests.ts";

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
const VALUE = "solicitante-test-value-123";

function setup(overrides: Partial<AnswerDeps> = {}) {
  const delivered: unknown[] = [];
  const deps: AnswerDeps = {
    hostId: "h1",
    hostUrl: "ws://127.0.0.1:7878/",
    vault: { list: () => [SECRET], value: async () => VALUE },
    policy: denyAllPolicy,
    deliver: async (payload) => {
      delivered.push(payload);
      return { expiresAt: 0 };
    },
    now: () => 1_000,
    ...overrides,
  };
  return { deps, delivered };
}

const frame = (requester: string): VaultRequestFrame =>
  ({
    type: "vault.request",
    requestId: "r1",
    secretId: "s1",
    purpose: "ssh",
    requester,
  }) as VaultRequestFrame;

describe("cofre-solicitante", () => {
  test("in this phase every request of the daemon is denied with the reason, and nothing is delivered", async () => {
    for (const requester of ["claude", "automation", "workflow"]) {
      const { deps, delivered } = setup();
      const outcome = await answerVaultRequest(frame(requester), deps);
      expect(outcome).toEqual({
        hostId: "h1",
        secretId: "s1",
        purpose: "ssh",
        requester,
        delivered: false,
        reason:
          "in this phase the daemon cannot ask the vault for secrets: only the uses the app starts are delivered",
      });
      expect(delivered).toEqual([]);
    }
  });

  test("a requester that is not claude, automation or workflow, you included, is unknown and denied even by a policy that delivers", async () => {
    for (const requester of ["you", "root", ""]) {
      const { deps, delivered } = setup({ policy: () => ({ kind: "deliver" }) });
      const outcome = await answerVaultRequest(frame(requester), deps);
      expect(outcome.delivered).toBe(false);
      expect(outcome.requester).toBe("unknown");
      expect(outcome.reason).toBe("unknown requester: a request of the daemon cannot be you");
      expect(delivered).toEqual([]);
    }
  });

  test("the policy is given the request, the host and the secret's entry (null when the vault has none)", async () => {
    const seen: unknown[] = [];
    const { deps } = setup({
      policy: (context) => {
        seen.push(context);
        return { kind: "deny", reason: "asked" };
      },
    });
    await answerVaultRequest(frame("claude"), deps);
    const other = setup({
      vault: { list: () => [], value: async () => null },
      policy: (context) => {
        seen.push(context);
        return { kind: "deny", reason: "asked" };
      },
    });
    await answerVaultRequest(frame("claude"), other.deps);
    expect(seen).toEqual([
      { request: frame("claude"), hostId: "h1", secret: SECRET },
      { request: frame("claude"), hostId: "h1", secret: null },
    ]);
  });

  test("the reason a policy gives for denying goes into the outcome", async () => {
    const { deps } = setup({ policy: async () => ({ kind: "deny", reason: "the user said no" }) });
    const outcome = await answerVaultRequest(frame("workflow"), deps);
    expect(outcome.delivered).toBe(false);
    expect(outcome.reason).toBe("the user said no");
  });
});
