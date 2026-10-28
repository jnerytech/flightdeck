import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { startDaemon } from "../src/main.ts";
import { tcpAlive, type WslItem, WslSupervisor, wslCommand } from "../src/wsl.ts";
import { poll, tempDir } from "./helpers.ts";

const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

const ITEM: WslItem = { distro: "Ubuntu", command: "~/.local/bin/flightdeckd start", port: 7421 };
const bun = (code: string) => [process.execPath, "-e", code];
const readLog = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("supervisor-wsl", () => {
  test("comando do wsl.exe para a distro", () => {
    expect(wslCommand(ITEM)).toEqual([
      "wsl.exe",
      "-d",
      "Ubuntu",
      "--exec",
      "bash",
      "-lc",
      "~/.local/bin/flightdeckd start",
    ]);
  });

  test("comando falso que morre é reiniciado com backoff crescente e grava log", async () => {
    const logDir = tempDir();
    const delays: number[] = [];
    const supervisor = new WslSupervisor([ITEM], {
      logDir,
      command: () => bun("console.log('subiu'); process.exit(1)"),
      baseDelayMs: 10,
      maxDelayMs: 80,
      onRestart: (_item, delay) => delays.push(delay),
    });
    supervisor.start();
    stops.push(() => supervisor.stop());
    await poll(() => delays.length >= 5, 4000);
    expect(delays.slice(0, 5)).toEqual([10, 20, 40, 80, 80]);
    expect(readLog(join(logDir, "wsl-Ubuntu.log"))).toContain("subiu");
  });

  test("ao encerrar o pai o filho é morto e nada mais é reiniciado", async () => {
    const delays: number[] = [];
    const supervisor = new WslSupervisor([ITEM], {
      logDir: tempDir(),
      command: () => bun("setInterval(() => {}, 1000)"),
      baseDelayMs: 10,
      onRestart: (_item, delay) => delays.push(delay),
    });
    supervisor.start();
    stops.push(() => supervisor.stop());
    const pids = supervisor.pids();
    expect(pids).toHaveLength(1);
    await supervisor.stop();
    expect(alive(pids[0] ?? 0)).toBe(false);
    await Bun.sleep(100);
    expect(delays).toEqual([]);
    expect(supervisor.pids()).toEqual([]);
  });

  test("saída com código 3 e porta respondendo conta como saudável: sem backoff, confere de novo", async () => {
    const delays: number[] = [];
    const healthy: string[] = [];
    const supervisor = new WslSupervisor([ITEM], {
      logDir: tempDir(),
      command: () => bun("process.exit(3)"),
      baseDelayMs: 10,
      healthCheckMs: 30,
      portAlive: async (port) => port === 7421,
      onRestart: (_item, delay) => delays.push(delay),
      onHealthy: (item) => healthy.push(item.distro),
    });
    supervisor.start();
    stops.push(() => supervisor.stop());
    await poll(() => healthy.length >= 2, 4000);
    expect(healthy.slice(0, 2)).toEqual(["Ubuntu", "Ubuntu"]);
    expect(delays).toEqual([]);
  });

  test("código 3 sem a porta respondendo é tratado como falha", async () => {
    const delays: number[] = [];
    const supervisor = new WslSupervisor([ITEM], {
      logDir: tempDir(),
      command: () => bun("process.exit(3)"),
      baseDelayMs: 10,
      maxDelayMs: 20,
      portAlive: async () => false,
      onRestart: (_item, delay) => delays.push(delay),
    });
    supervisor.start();
    stops.push(() => supervisor.stop());
    await poll(() => delays.length >= 3, 4000);
    expect(delays.slice(0, 3)).toEqual([10, 20, 20]);
  });

  test("seção wsl da config sobe o supervisor junto com o daemon e o para junto", async () => {
    const dir = tempDir();
    const file = join(dir, "config.json");
    const marker = join(dir, "filho-rodou.txt");
    writeFileSync(
      file,
      JSON.stringify({ port: 0, token: "t".repeat(32), dataDir: join(dir, "data"), wsl: [ITEM] }),
    );
    expect(loadConfig(file).wsl).toEqual([ITEM]);
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
      {
        wslCommand: () =>
          bun(
            `require("node:fs").writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(() => {}, 1000)`,
          ),
      },
    );
    stops.push(() => daemon.stop());
    await poll(() => existsSync(marker), 4000);
    expect(existsSync(join(dir, "data", "logs", "wsl-Ubuntu.log"))).toBe(true);
    const childPid = Number(readLog(marker));
    expect(childPid > 0 && alive(childPid)).toBe(true);
    await daemon.stop();
    expect(alive(childPid)).toBe(false);
  });

  test("config sem wsl tem lista vazia; item inválido é recusado", () => {
    const file = join(tempDir(), "config.json");
    writeFileSync(file, JSON.stringify({ token: "t".repeat(32) }));
    expect(loadConfig(file).wsl).toEqual([]);
    writeFileSync(
      file,
      JSON.stringify({ token: "t".repeat(32), wsl: [{ distro: "", command: "x", port: 1 }] }),
    );
    expect(() => loadConfig(file)).toThrow();
  });

  test("tcpAlive detecta porta escutando em 127.0.0.1", async () => {
    const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    expect(await tcpAlive(server.port)).toBe(true);
    server.stop(true);
    expect(await tcpAlive(server.port)).toBe(false);
  });
});
