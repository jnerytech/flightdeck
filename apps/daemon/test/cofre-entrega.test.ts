import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { runCli, vaultActions } from "../src/main.ts";
import { startServer } from "../src/server.ts";
import { isVaultTransport, Vault, type VaultDelivery } from "../src/vault/vault.ts";
import { newManager, poll, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "cofre-token-0123456789abcdef";
const VALUE = "ghp_SEGREDO-DE-TESTE-9f3a1c7e\ncom quebra e acentuação é ç 中";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const echo = { echo: sha };

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

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
const code = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (error) {
    return `${(error as { code?: string }).code}: ${(error as Error).message}`;
  }
};

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
      "cheio",
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

  test("protocolo: vault.deliver, vault.use (com o frame vault.used sem o valor) e as recusas", async () => {
    const { manager } = newManager();
    const vault = new Vault({ actions: echo });
    cleanups.push(() => vault.stop());
    const server = startServer({
      manager,
      vault,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const payload = {
      secretId: "tok",
      value: VALUE,
      purpose: "acao",
      expiresAt: Date.now() + 30_000,
    };
    const ack = await client.data<{ expiresAt: number }>("vault.deliver", payload);
    expect(ack?.expiresAt).toBe(payload.expiresAt);
    expect(
      await client.data("vault.use", { secretId: "tok", purpose: "acao", action: "lerValor" }),
    ).toBeNull();
    expect(
      await client.data<{ result: string }>("vault.use", {
        secretId: "tok",
        purpose: "acao",
        action: "echo",
      }),
    ).toEqual({ result: sha(VALUE) });
    const used = await poll(() => client.frames.find((f) => f.type === "vault.used"), 2000);
    expect(used).toMatchObject({
      secretId: "tok",
      purpose: "acao",
      requester: "you",
      action: "echo",
      at: expect.any(String),
    });
    expect(JSON.stringify(client.frames)).not.toContain("SEGREDO-DE-TESTE");
    expect(
      await client.request("vault.use", { secretId: "tok", purpose: "acao", action: "echo" }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await client.request("vault.deliver", { ...payload, value: "" })).toMatchObject({
      ok: false,
      error: { code: "bad_request" },
    });
  });

  test("protocolo: daemon sem cofre responde invalid_state", async () => {
    const { manager } = newManager();
    const server = startServer({
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    expect(
      await client.request("vault.deliver", {
        secretId: "s",
        value: "v",
        purpose: "ssh",
        expiresAt: Date.now() + 1000,
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_state" } });
  });

  test("por uma rede que não é loopback nem Tailscale, a entrega chega ao daemon e é recusada", async () => {
    const lan = Object.values(networkInterfaces())
      .flatMap((list) => list ?? [])
      .find((i) => i.family === "IPv4" && !i.internal && !isVaultTransport(i.address));
    if (!lan) return; // a machine with no such interface (the check above is the same function)
    const { manager } = newManager();
    const logs: string[] = [];
    const vault = new Vault({ actions: echo, log: (m) => logs.push(m) });
    cleanups.push(() => vault.stop());
    const server = startServer({
      manager,
      vault,
      hostName: "h",
      bind: lan.address,
      port: 0,
      token: TOKEN,
      allowedRoots: [],
      allowedNetworks: [`${lan.address}/32`],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const ack = await client.request("vault.deliver", {
      secretId: "s",
      value: VALUE,
      purpose: "ssh",
      expiresAt: Date.now() + 30_000,
    });
    expect(ack).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    expect(JSON.stringify(ack)).toContain("Tailscale");
    expect(vault.held()).toBe(0);
    expect(logs.join("\n")).not.toContain("SEGREDO-DE-TESTE");
  });

  test("daemon de verdade: o valor não vai para o log, nem para o banco, nem para nenhum arquivo", async () => {
    const dir = tempDir();
    const file = join(dir, "config.json");
    const token = "cofre-real-token-0123456789a";
    const dataDir = join(dir, "data");
    const out: string[] = [];
    const spy = {
      log: (m: string) => out.push(m),
      error: (m: string) => out.push(m),
    };
    const real = { log: console.log, error: console.error, warn: console.warn };
    console.log = (...a: unknown[]) => out.push(a.join(" "));
    console.error = (...a: unknown[]) => out.push(a.join(" "));
    console.warn = (...a: unknown[]) => out.push(a.join(" "));
    cleanups.push(() => Object.assign(console, real));
    await Bun.write(
      file,
      JSON.stringify({ port: 0, token, dataDir, hooks: { port: 0 }, allowedRoots: [] }),
    );
    const daemon = await runCli(["--config", file, "--runtime", "fake"], {
      env: {},
      log: spy,
      exit: () => {},
      onSignal: () => {},
    });
    cleanups.push(() => daemon?.stop());
    const client = new FrameClient(daemon?.url ?? "");
    cleanups.push(() => client.close());
    await client.request("hello", { token, client: "t" });
    const secrets = [VALUE, "ghp_OUTRO-SEGREDO-DE-TESTE-77", "senha com espaço e = sinal"];
    for (const [i, value] of secrets.entries()) {
      const secretId = `real-${i}`;
      await client.data("vault.deliver", {
        secretId,
        value,
        purpose: "ssh",
        expiresAt: Date.now() + 30_000,
      });
      if (i < 2) await client.data("vault.use", { secretId, purpose: "ssh", action: "echo" });
    }
    // A bad request carrying a value is refused without leaving it anywhere.
    await client.request("vault.deliver", { secretId: "", value: secrets[0], purpose: "ssh" });
    await Bun.sleep(100);
    await daemon?.stop();
    const files: Buffer[] = [];
    const walk = (folder: string) => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) walk(path);
        else files.push(readFileSync(path));
      }
    };
    walk(dataDir);
    expect(files.length).toBeGreaterThan(0);
    const haystacks = [...files, Buffer.from(out.join("\n"))];
    for (const value of secrets) {
      const needles = [
        Buffer.from(value, "utf8"),
        Buffer.from(value, "utf8").toString("base64"),
        Buffer.from(value, "utf8").toString("hex"),
      ];
      for (const hay of haystacks) {
        for (const needle of needles) {
          expect(typeof needle === "string" ? hay.includes(needle) : hay.includes(needle)).toBe(
            false,
          );
        }
      }
    }
  });

  test("um daemon com o runtime real recusa o vault.use echo, e o segredo não é gasto", async () => {
    const dir = tempDir();
    const file = join(dir, "config.json");
    const token = "cofre-claude-token-0123456789";
    await Bun.write(
      file,
      JSON.stringify({
        port: 0,
        token,
        dataDir: join(dir, "data"),
        hooks: { port: 0 },
        allowedRoots: [],
      }),
    );
    const daemon = await runCli(["--config", file, "--runtime", "claude"], {
      env: {},
      log: { log: () => {}, error: () => {} },
      exit: () => {},
      onSignal: () => {},
    });
    cleanups.push(() => daemon?.stop());
    const client = new FrameClient(daemon?.url ?? "");
    cleanups.push(() => client.close());
    await client.request("hello", { token, client: "t" });
    await client.data("vault.deliver", {
      secretId: "real",
      value: VALUE,
      purpose: "ssh",
      expiresAt: Date.now() + 30_000,
    });
    const refused = await client.request("vault.use", {
      secretId: "real",
      purpose: "ssh",
      action: "echo",
    });
    expect(refused).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    expect(JSON.stringify(refused)).not.toContain("SEGREDO-DE-TESTE");
    expect(JSON.stringify(refused)).not.toContain(sha(VALUE));
  });
});
