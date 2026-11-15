import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { runCli } from "../../src/main.ts";
import { startServer } from "../../src/server.ts";
import { isVaultTransport, requireVaultTransport, Vault } from "../../src/vault/vault.ts";
import { newManager, poll, tempDir } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { cleanups, code, echo, runCleanups, sha, TOKEN, VALUE } from "../support/vault-delivery.ts";

afterEach(runCleanups);

describe("cofre-entrega: protocolo e daemon de verdade", () => {
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

  test("a vault key from outside loopback and Tailscale is refused with the reason and logged without the key", () => {
    const logs: string[] = [];
    const refused = code(() =>
      requireVaultTransport("192.168.1.5", "ssh.connect", (m) => logs.push(m)),
    );
    expect(refused).toStartWith("invalid_state:");
    expect(refused).toContain("loopback");
    expect(refused).toContain("Tailscale");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("192.168.1.5");
    expect(logs[0]).toContain("ssh.connect");
    for (const ok of ["127.0.0.1", "::1", "100.64.0.9", "fd7a:115c:a1e0::1"]) {
      expect(code(() => requireVaultTransport(ok, "ssh.connect"))).toBe("ok");
    }
  });

  test("ssh.connect and ssh.test with a key from a LAN connection are refused before anything runs, and the key is not logged", async () => {
    const lan = Object.values(networkInterfaces())
      .flatMap((list) => list ?? [])
      .find((i) => i.family === "IPv4" && !i.internal && !isVaultTransport(i.address));
    if (!lan) return; // a machine with no such interface (the unit test above is the same function)
    const calls: string[] = [];
    const logs: string[] = [];
    const server = startServer({
      manager: newManager().manager,
      ssh: {
        connect: {
          connect: async (req: { privateKey?: string }) =>
            void calls.push(`connect:${req.privateKey ?? ""}`),
          test: async (req: { privateKey?: string }) =>
            void calls.push(`test:${req.privateKey ?? ""}`),
        } as never,
      },
      log: (m) => logs.push(m),
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
    const key =
      "-----BEGIN OPENSSH PRIVATE KEY-----\nSEGREDO-DE-TESTE-ssh\n-----END OPENSSH PRIVATE KEY-----\n";
    const connect = await client.request("ssh.connect", {
      targetId: "t1",
      cols: 80,
      rows: 24,
      privateKey: key,
    });
    const test = await client.request("ssh.test", { targetId: "t1", privateKey: key });
    for (const ack of [connect, test]) {
      expect(ack).toMatchObject({ ok: false, error: { code: "invalid_state" } });
      expect(JSON.stringify(ack)).toContain("Tailscale");
      expect(JSON.stringify(ack)).not.toContain("SEGREDO-DE-TESTE");
    }
    expect(calls).toEqual([]);
    expect(logs.join("\n")).not.toContain("SEGREDO-DE-TESTE");
    expect(logs.length).toBeGreaterThan(0);
    // Without a key (agent or key file on the host) the LAN connection still works.
    await client.request("ssh.connect", { targetId: "t1", cols: 80, rows: 24 });
    expect(calls).toEqual(["connect:"]);
  });

  test("over loopback the key reaches ssh.connect and ssh.test", async () => {
    const calls: string[] = [];
    const server = startServer({
      manager: newManager().manager,
      ssh: {
        connect: {
          connect: async (req: { privateKey?: string }) =>
            void calls.push(`connect:${req.privateKey}`),
          test: async (req: { privateKey?: string }) => void calls.push(`test:${req.privateKey}`),
        } as never,
      },
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
    await client.request("ssh.connect", { targetId: "t1", cols: 80, rows: 24, privateKey: "k1" });
    await client.request("ssh.test", { targetId: "t1", privateKey: "k2" });
    expect(calls).toEqual(["connect:k1", "test:k2"]);
  });
});
