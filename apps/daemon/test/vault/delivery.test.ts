import { afterEach, describe, expect, test } from "bun:test";
import { vaultActions } from "../../src/vault/index.ts";
import { isVaultTransport, Vault, type VaultDelivery } from "../../src/vault/vault.ts";
import { poll } from "../support/helpers.ts";
import { cleanups, code, echo, runCleanups, sha, VALUE } from "../support/vault-delivery.ts";

afterEach(runCleanups);

const NOW = 1_800_000_000_000;
function delivery(over: Partial<VaultDelivery> = {}): VaultDelivery {
  return {
    secretId: "s1",
    value: VALUE,
    purpose: "ssh",
    expiresAt: NOW + 30_000,
    requester: "you",
    ...over,
  };
}
function setup(over: { ttlMs?: number; now?: { at: number } } = {}) {
  const now = over.now ?? { at: NOW };
  const logs: string[] = [];
  const vault = new Vault({
    clock: () => now.at,
    log: (message) => logs.push(message),
    actions: echo,
    ...(over.ttlMs ? { ttlMs: over.ttlMs } : {}),
  });
  cleanups.push(() => vault.stop());
  return { vault, now, logs };
}

describe("cofre-entrega", () => {
  test("só loopback e as faixas da Tailscale são transporte aceito", () => {
    for (const ok of [
      "127.0.0.1",
      "127.8.9.10",
      "::1",
      "::ffff:127.0.0.1",
      "100.64.0.1",
      "100.100.100.100",
      "100.127.255.255",
      "fd7a:115c:a1e0::1",
      "fd7a:115c:a1e0:ab12::9",
    ]) {
      expect([ok, isVaultTransport(ok)]).toEqual([ok, true]);
    }
    for (const no of [
      "192.168.1.5",
      "10.0.0.1",
      "172.16.0.9",
      "100.63.255.255",
      "100.128.0.0",
      "8.8.8.8",
      "fe80::1",
      "fd7a:115c:a1e1::1",
      "2001:db8::1",
      "",
      "não-é-ip",
    ]) {
      expect([no, isVaultTransport(no)]).toEqual([no, false]);
    }
  });

  test("entrega e uso: o valor sai da memória no uso e o segundo uso falha dizendo que o app tem de entregar", () => {
    const { vault } = setup();
    expect(vault.deliver(delivery(), "127.0.0.1")).toEqual({ expiresAt: NOW + 30_000 });
    expect(vault.held()).toBe(1);
    expect(vault.use("s1", "ssh", "echo")).toEqual({ result: sha(VALUE), requester: "you" });
    expect(vault.held()).toBe(0);
    const again = code(() => vault.use("s1", "ssh", "echo"));
    expect(again).toStartWith("not_found:");
    expect(again).toContain("app");
    expect(code(() => vault.use("nunca-entregue", "ssh", "echo"))).toStartWith("not_found:");
  });

  test("no máximo 60 s: um prazo maior é encurtado, e passado o prazo o valor já não existe", () => {
    const { vault, now } = setup();
    expect(vault.deliver(delivery({ expiresAt: NOW + 600_000 }), "127.0.0.1")).toEqual({
      expiresAt: NOW + 60_000,
    });
    now.at = NOW + 59_999;
    expect(vault.held()).toBe(1);
    now.at = NOW + 60_001;
    expect(code(() => vault.use("s1", "ssh", "echo"))).toStartWith("not_found:");
    expect(vault.held()).toBe(0);
    // A shorter deadline of the app wins.
    now.at = NOW;
    vault.deliver(delivery({ expiresAt: NOW + 2_000 }), "127.0.0.1");
    now.at = NOW + 2_001;
    expect(code(() => vault.use("s1", "ssh", "echo"))).toStartWith("not_found:");
  });

  test("o temporizador descarta o valor sozinho, sem ninguém usar", async () => {
    const { vault } = setup({ ttlMs: 40 });
    vault.deliver(delivery({ expiresAt: NOW + 600_000 }), "127.0.0.1");
    // The injected clock stands still, so only the timer can have removed it.
    expect(vault.held()).toBe(1);
    expect(await poll(() => vault.held() === 0, 1000)).toBe(true);
  });

  test("um prazo que já passou, ou o cofre cheio, é recusado", () => {
    const { vault } = setup();
    expect(code(() => vault.deliver(delivery({ expiresAt: NOW }), "127.0.0.1"))).toStartWith(
      "invalid_state:",
    );
    for (let i = 0; i < 64; i++) {
      vault.deliver(delivery({ secretId: `s${i}` }), "127.0.0.1");
    }
    expect(code(() => vault.deliver(delivery({ secretId: "extra" }), "127.0.0.1"))).toContain(
      "full",
    );
    // Delivering the same secret again replaces it instead of filling a slot.
    vault.deliver(delivery({ secretId: "s3", value: "outro" }), "127.0.0.1");
    expect(vault.held()).toBe(64);
    expect(vault.use("s3", "ssh", "echo").result).toBe(sha("outro"));
  });

  test("fora do loopback e da Tailscale a entrega é recusada com o motivo e registrada sem o valor", () => {
    const { vault, logs } = setup();
    const refused = code(() => vault.deliver(delivery(), "192.168.1.5"));
    expect(refused).toStartWith("invalid_state:");
    expect(refused).toContain("loopback");
    expect(refused).toContain("Tailscale");
    expect(vault.held()).toBe(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("192.168.1.5");
    expect(logs[0]).toContain("s1");
    expect(logs.join("\n")).not.toContain("SEGREDO-DE-TESTE");
  });

  test("o uso pede a mesma finalidade da entrega e uma ação que existe; uma tentativa errada não gasta o valor", () => {
    const { vault } = setup();
    vault.deliver(delivery(), "127.0.0.1");
    expect(code(() => vault.use("s1", "outra-finalidade", "echo"))).toStartWith("invalid_state:");
    expect(code(() => vault.use("s1", "ssh", "lerValor"))).toStartWith("invalid_state:");
    expect(vault.held()).toBe(1);
    expect(vault.use("s1", "ssh", "echo").result).toBe(sha(VALUE));
  });

  test("uma ação que falha não repassa a mensagem do erro (ela poderia trazer o valor) e o valor já saiu da memória", () => {
    const logs: string[] = [];
    const vault = new Vault({
      clock: () => NOW,
      log: (message) => logs.push(message),
      actions: {
        quebra: (value) => {
          throw new Error(`falhou com ${value}`);
        },
      },
    });
    cleanups.push(() => vault.stop());
    vault.deliver(delivery(), "127.0.0.1");
    const failed = code(() => vault.use("s1", "ssh", "quebra"));
    expect(failed).toStartWith("invalid_state:");
    expect(failed).not.toContain("SEGREDO-DE-TESTE");
    expect(logs.join("\n")).not.toContain("SEGREDO-DE-TESTE");
    expect(logs.join("\n")).toContain("quebra");
    expect(vault.held()).toBe(0);
  });

  test("parar o cofre apaga o que está em memória", () => {
    const { vault } = setup();
    vault.deliver(delivery(), "127.0.0.1");
    vault.stop();
    expect(vault.held()).toBe(0);
    expect(code(() => vault.use("s1", "ssh", "echo"))).toStartWith("not_found:");
  });

  test("a ação echo só existe com o runtime fake e devolve só o SHA-256", () => {
    expect(Object.keys(vaultActions("fake"))).toEqual(["echo"]);
    expect(vaultActions("fake").echo?.(VALUE)).toBe(sha(VALUE));
    expect(vaultActions("claude")).toEqual({});
  });
});
