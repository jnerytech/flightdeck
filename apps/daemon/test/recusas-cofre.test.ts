import { afterEach, describe, expect, test } from "bun:test";
import { Vault, type VaultDelivery } from "../src/vault/vault.ts";

const NOW = 1_800_000_000_000;
const vaults: Vault[] = [];
afterEach(() => {
  for (const vault of vaults.splice(0)) vault.stop();
});

function newVault(actions: Record<string, (value: string) => string> = { echo: (v) => v }) {
  const vault = new Vault({ clock: () => NOW, actions });
  vaults.push(vault);
  return vault;
}
const delivery = (over: Partial<VaultDelivery> = {}): VaultDelivery => ({
  secretId: "s1",
  value: "v",
  purpose: "ssh",
  expiresAt: NOW + 30_000,
  requester: "you",
  ...over,
});

/** What a refusal carries: the code, the reason the app translates, its params and the log text. */
function refusal(fn: () => unknown) {
  try {
    fn();
    return null;
  } catch (error) {
    const { code, reason, params, message } = error as {
      code: string;
      reason?: string;
      params?: Record<string, string | number>;
      message: string;
    };
    return { code, reason, params, message };
  }
}
async function refusalOf(promise: Promise<unknown>) {
  try {
    await promise;
    return null;
  } catch (error) {
    const { code, reason, params, message } = error as {
      code: string;
      reason?: string;
      params?: Record<string, string | number>;
      message: string;
    };
    return { code, reason, params, message };
  }
}

describe("recusas-cofre: the vault refuses with a reason the app translates", () => {
  test("a delivery from outside loopback and Tailscale, an expired one and a full vault each have a reason", () => {
    const vault = newVault();
    expect(refusal(() => vault.deliver(delivery(), "8.8.8.8"))).toMatchObject({
      code: "invalid_state",
      reason: "transport_refused",
    });
    expect(
      refusal(() => vault.deliver(delivery({ expiresAt: NOW - 1 }), "127.0.0.1")),
    ).toMatchObject({ reason: "secret_expired" });
    for (let i = 0; i < 1000; i++) {
      if (refusal(() => vault.deliver(delivery({ secretId: `k${i}` }), "127.0.0.1"))) break;
    }
    expect(
      refusal(() => vault.deliver(delivery({ secretId: "one-more" }), "127.0.0.1")),
    ).toMatchObject({
      reason: "vault_full",
    });
  });

  test("using a secret: not on this daemon, for another purpose, an unknown action, an action that fails", () => {
    const vault = newVault({
      echo: (v) => v,
      boom: () => {
        throw new Error("x");
      },
    });
    expect(refusal(() => vault.use("zzz", "ssh", "echo"))).toMatchObject({
      code: "not_found",
      reason: "secret_not_here",
      params: { id: "zzz" },
    });
    vault.deliver(delivery(), "127.0.0.1");
    expect(refusal(() => vault.use("s1", "action", "echo"))).toMatchObject({
      reason: "secret_purpose_mismatch",
      params: { held: "ssh", purpose: "action" },
    });
    expect(refusal(() => vault.use("s1", "ssh", "nope"))).toMatchObject({
      reason: "vault_action_unknown",
      params: { action: "nope" },
    });
    expect(refusal(() => vault.use("s1", "ssh", "boom"))).toMatchObject({
      reason: "vault_action_failed",
      params: { action: "boom" },
    });
  });

  test("waiting for a secret: past the deadline, cancelled, and the vault closing", async () => {
    const vault = newVault();
    expect(await refusalOf(vault.waitFor("w1", "ssh", 1))).toMatchObject({
      reason: "secret_wait_timeout",
      params: { id: "w1" },
    });
    const controller = new AbortController();
    controller.abort();
    expect(await refusalOf(vault.waitFor("w2", "ssh", 1000, controller.signal))).toMatchObject({
      reason: "secret_wait_cancelled",
      params: { id: "w2" },
    });
    const pending = refusalOf(vault.waitFor("w3", "ssh", 1000));
    vault.stop();
    expect(await pending).toMatchObject({ reason: "vault_closed" });
  });

  test("every message is English technical text", async () => {
    const vault = newVault();
    const messages = [
      refusal(() => vault.deliver(delivery(), "8.8.8.8"))?.message,
      refusal(() => vault.use("zzz", "ssh", "echo"))?.message,
      (await refusalOf(vault.waitFor("w1", "ssh", 1)))?.message,
    ];
    for (const message of messages) expect(message).not.toMatch(/[À-ú]|\b(segredo|cofre)\b/);
  });
});
