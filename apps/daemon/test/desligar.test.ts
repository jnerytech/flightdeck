import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "@flightdeck/protocol";
import { acquireLock } from "../src/lock.ts";
import { runCli } from "../src/main.ts";
import { startServer } from "../src/server.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "desligar-token-0123456789abcdef";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await Bun.sleep(10);
  }
}

function connect(url: string) {
  const client = new FrameClient(url);
  cleanups.push(() => client.close());
  return client;
}

describe("desligar", () => {
  test("daemon.shutdown é um comando sem payload", () => {
    expect(Command.safeParse({ id: "1", type: "daemon.shutdown", payload: {} }).success).toBe(true);
    expect(
      Command.safeParse({ id: "1", type: "daemon.shutdown", payload: { agora: true } }).success,
    ).toBe(false);
  });

  test("o servidor responde e só então pede o desligamento; sem quem desligue, recusa", async () => {
    const { manager } = newManager();
    let asked = 0;
    const base = {
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    };
    const server = startServer({ ...base, onShutdown: () => asked++ });
    cleanups.push(() => server.stop());
    const client = connect(server.url);
    await client.request("hello", { token: TOKEN, client: "t" });
    expect(await client.request("daemon.shutdown", {})).toMatchObject({ ok: true });
    await until(() => asked > 0, "pedido de desligamento");
    expect(asked).toBe(1);

    const without = startServer(base);
    cleanups.push(() => without.stop());
    const other = connect(without.url);
    await other.request("hello", { token: TOKEN, client: "t" });
    expect(await other.request("daemon.shutdown", {})).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
  });

  test("flightdeckd start: daemon.shutdown fecha como o SIGTERM, solta o lock e sai com 0", async () => {
    const dir = tempDir();
    const dataDir = join(dir, "data");
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ port: 0, token: TOKEN, dataDir, hooks: { port: 0 } }));
    const exits: number[] = [];
    const daemon = await runCli(["--config", file, "--runtime", "fake"], {
      env: {},
      log: { log: () => {}, error: () => {} },
      exit: (code) => exits.push(code),
      onSignal: () => {},
    });
    expect(daemon).not.toBeNull();
    const client = connect(daemon?.url ?? "");
    await client.request("hello", { token: TOKEN, client: "t" });
    expect(await client.request("daemon.shutdown", {})).toMatchObject({ ok: true });
    await until(() => exits.length > 0, "o daemon sair");
    expect(exits).toEqual([0]);
    const lock = acquireLock(dataDir);
    expect(lock).not.toBeNull();
    lock?.release();
  });
});
