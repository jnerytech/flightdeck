import { describe, expect, test } from "bun:test";
import type { VaultRequestFrame } from "@flightdeck/protocol";
import { type VaultApprovalsCore, VaultApprovalsSlice } from "../src/features/vault/index.ts";
import type { PendingItem } from "../src/lib/app-store.ts";
import type { SecretMeta } from "../src/lib/vault.ts";
import type { VaultOutcome, VaultPolicy } from "../src/lib/vault-requests.ts";

const VALUE = "the-secret-value-123";
const SECRET = { id: "s1", name: "deploy key", allowedHosts: ["h"] } as unknown as SecretMeta;
const HOST = { id: "h", url: "ws://localhost:7777" };
const ACTION: VaultRequestFrame = {
  type: "vault.request",
  requestId: "r1",
  secretId: "s1",
  purpose: "action",
  requester: "claude",
  action: "deploy",
  params: { env: "staging" },
  decision: "ask",
  once: true,
};

/**
 * A slice over stand-ins: every command sent to a host is written down as `type payload`, every
 * notice as its title, and the outcomes the usage log would get as they come.
 */
function slice(over: { policy?: VaultPolicy; now?: number; denyFails?: boolean } = {}) {
  let pending: PendingItem[] = [];
  const sent: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const notices: string[] = [];
  const recorded: VaultOutcome[] = [];
  const core: VaultApprovalsCore = {
    vault: {
      list: () => [SECRET],
      value: async () => VALUE,
    } as unknown as VaultApprovalsCore["vault"],
    pending: () => pending,
    setPending: (items) => {
      pending = items;
    },
    hostName: (id) => (id === "h" ? "alfa" : null),
    dispatch: (async (_host: string, type: string, payload: Record<string, unknown>) => {
      sent.push({ type, payload });
      if (over.denyFails && type === "vault.deny") throw new Error("the host is gone");
      return {};
    }) as VaultApprovalsCore["dispatch"],
    policy: () => over.policy,
    now: () => over.now ?? 1_000,
    notify: (title) => {
      notices.push(title);
    },
    recorded: (outcome) => {
      recorded.push(outcome);
    },
    t: () => ((key: string) => key) as never,
  };
  return {
    approvals: new VaultApprovalsSlice(core),
    pending: () => pending,
    sent,
    notices,
    recorded,
  };
}

describe("vault approvals slice", () => {
  test("a request that must ask waits in the queue, and the answer delivers the value once", async () => {
    const { approvals, pending, sent, notices } = slice();
    const done = approvals.onRequest(HOST, ACTION);
    expect(pending().map((i) => [i.requestId, i.toolName, i.vault, i.vaultOnce])).toEqual([
      ["r1", "deploy", true, true],
    ]);
    expect(pending()[0]?.hostName).toBe("alfa");
    expect(notices).toEqual(["vaultApproval.notifyTitle"]);
    expect(JSON.stringify(pending())).not.toContain(VALUE);
    expect(approvals.settle("r1", { scope: "once", via: "app" })).toBe(true);
    await done;
    expect(pending()).toEqual([]);
    expect(sent.map((c) => c.type)).toEqual(["vault.approve", "vault.deliver"]);
    expect(sent[1]?.payload.value).toBe(VALUE);
  });

  test("a refusal leaves the queue, delivers nothing and tells the daemon at once", async () => {
    const { approvals, pending, sent, recorded } = slice();
    const done = approvals.onRequest(HOST, ACTION);
    expect(approvals.settle("r1", null)).toBe(true);
    await done;
    expect(pending()).toEqual([]);
    expect(sent).toEqual([{ type: "vault.deny", payload: { requestId: "r1" } }]);
    expect(recorded.map((o) => o.delivered)).toEqual([false]);
    expect(JSON.stringify(recorded)).not.toContain(VALUE);
  });

  test("a request nobody answers by the daemon's deadline is denied and leaves the queue", async () => {
    const { approvals, pending, sent } = slice({ now: 5_000 });
    await approvals.onRequest(HOST, { ...ACTION, expiresAt: 5_000 });
    expect(pending()).toEqual([]);
    expect(sent.map((c) => c.type)).toEqual(["vault.deny"]);
  });

  test("an answer to a request the vault never asked about is not taken", () => {
    expect(slice().approvals.settle("other", { scope: "once", via: "app" })).toBe(false);
  });

  test("the session approval covers a once-only action, never a free command", async () => {
    const { approvals, pending, sent } = slice();
    const action = approvals.onRequest(HOST, ACTION);
    approvals.approveForSession("h", "r1");
    await action;
    expect(sent.find((c) => c.type === "vault.approve")?.payload.scope).toBe("session");

    const command = approvals.onRequest(HOST, {
      ...ACTION,
      requestId: "r2",
      action: undefined,
      command: "deploy.sh",
    });
    expect(pending()[0]?.risk).toBe("high");
    approvals.approveForSession("h", "r2");
    expect(pending().map((i) => i.requestId)).toEqual(["r2"]);
    approvals.settle("r2", null);
    await command;
  });

  test("a request that needs holding is approved with the hold, never for the session", async () => {
    const { approvals, pending, sent } = slice();
    const done = approvals.onRequest(HOST, { ...ACTION, needsHold: true });
    expect(pending()[0]?.vaultOnce).toBeUndefined();
    approvals.approveForSession("h", "r1");
    expect(pending()).toHaveLength(1);
    approvals.settle("r1", { scope: "once", via: "app" });
    await done;
    expect(sent.find((c) => c.type === "vault.approve")?.payload.heldMs).toBeGreaterThan(0);
  });

  test("the options' policy replaces the queue, and a listener hears each outcome until it stops", async () => {
    const { approvals, pending, sent } = slice({
      policy: () => ({ kind: "deny", reason: "denied by the options" }),
    });
    const heard: string[] = [];
    const stop = approvals.onOutcome((o) => heard.push(o.reason));
    await approvals.onRequest(HOST, ACTION);
    stop();
    await approvals.onRequest(HOST, { ...ACTION, requestId: "r2" });
    expect(heard).toEqual(["denied by the options"]);
    expect(pending()).toEqual([]);
    expect(sent.map((c) => c.type)).toEqual(["vault.deny", "vault.deny"]);
  });

  test("a host that cannot be told of the refusal does not stop the outcome from being heard", async () => {
    const { approvals, recorded } = slice({
      policy: () => ({ kind: "deny", reason: "no" }),
      denyFails: true,
    });
    const heard: string[] = [];
    approvals.onOutcome((o) => heard.push(o.reason));
    await approvals.onRequest(HOST, ACTION);
    expect(heard).toEqual(["no"]);
    expect(recorded).toHaveLength(1);
  });
});
