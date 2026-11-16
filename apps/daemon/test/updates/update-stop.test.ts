import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { acquireLock, readLockPid } from "../../src/kernel/lock.ts";
import { startServer } from "../../src/server.ts";
import { killProcess, processPath } from "../../src/service/os.ts";
import { requestShutdown, swapBinary, waitHealthy } from "../../src/service/update.ts";
import { newManager, tempDir } from "../support/helpers.ts";

import {
  cleanups,
  DIST_WIN,
  fakeBinary,
  previous,
  setup,
  teardown,
  update,
} from "./update-setup.ts";

afterEach(teardown);

describe("update: stopping the daemon, health and binary swap", () => {
  test("para o daemon pedindo daemon.shutdown antes de parar o serviço", async () => {
    const { deps, calls } = setup("win32", DIST_WIN);
    const asked: number[] = [];
    deps.shutdown = async (config) => {
      // Only the service query ran so far.
      asked.push(calls.length);
      return config.port === 7420;
    };
    expect(await update(deps, fakeBinary("0.8.0"))).toBe(0);
    expect(asked).toEqual([1]);
    expect(calls.map((c) => c[1])).toEqual(["/Query", "/End", "/Create", "/Run"]);
  });

  test("lock ainda preso: mata o PID só se o executável dele for o do serviço", async () => {
    const killed: number[] = [];
    const stuck = (path: string) => {
      const s = setup("win32", DIST_WIN);
      s.deps.daemonRunning = () => killed.length === 0;
      s.deps.lockPid = () => 4242;
      s.deps.processPath = async (pid) => (pid === 4242 ? path : null);
      s.deps.kill = (pid) => {
        killed.push(pid);
      };
      return s;
    };
    const same = stuck(DIST_WIN.toUpperCase());
    expect(await update(same.deps, fakeBinary("0.8.0"))).toBe(0);
    expect(killed).toEqual([4242]);
    expect(same.out.join("\n")).toContain("processo 4242");
    killed.length = 0;
    const other = stuck("C:\\outro\\programa.exe");
    previous(other.stable);
    expect(await update(other.deps, fakeBinary("0.8.0"))).toBe(1);
    expect(killed).toEqual([]);
    expect(other.out.join("\n")).toContain("o daemon não parou");
    expect(readFileSync(other.stable, "utf8")).toBe("versão antiga");
  });

  test("lock ainda preso: o executável do processo e o do serviço são comparados com os links resolvidos", async () => {
    const real = join(tempDir(), "versao-1");
    mkdirSync(real);
    writeFileSync(join(real, "flightdeckd.exe"), "");
    const link = join(tempDir(), "atual");
    symlinkSync(real, link, "junction");
    const killed: number[] = [];
    const s = setup("win32", join(link, "flightdeckd.exe"));
    s.deps.daemonRunning = () => killed.length === 0;
    s.deps.lockPid = () => 4242;
    s.deps.processPath = async () => join(real, "flightdeckd.exe");
    s.deps.kill = (pid) => {
      killed.push(pid);
    };
    expect(await update(s.deps, fakeBinary("0.8.0"))).toBe(0);
    expect(killed).toEqual([4242]);
  });

  test("peças reais: daemon.shutdown pelo WebSocket, PID do lock, executável e kill de um processo", async () => {
    const token = "update-token-0123456789abcdef";
    const { manager } = newManager();
    let asked = 0;
    const server = startServer({
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token,
      allowedRoots: [],
      onShutdown: () => asked++,
    });
    cleanups.push(() => server.stop());
    expect(await requestShutdown(server.url, token, 2000)).toBe(true);
    // The daemon starts closing as soon as the ack is on its way, not on a later timer tick:
    // a timer could fire only after the next requests had already finished.
    expect(asked).toBe(1);
    expect(await requestShutdown(server.url, "x".repeat(32), 2000)).toBe(false);
    const closed = Bun.serve({ port: 0, fetch: () => new Response("") });
    const port = closed.port;
    await closed.stop(true);
    expect(await requestShutdown(`ws://127.0.0.1:${port}/v1/ws`, token, 500)).toBe(false);
    expect(asked).toBe(1);

    const dataDir = tempDir();
    expect(await readLockPid(dataDir)).toBeNull();
    const lock = await acquireLock(dataDir);
    cleanups.push(() => lock?.release());
    expect(await readLockPid(dataDir)).toBe(process.pid);

    // Paths compared after links are resolved (a package manager may install bun behind one).
    const own = await processPath(process.pid);
    expect(realpathSync.native(own ?? "")).toBe(realpathSync.native(process.execPath));
    const child = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
      env: process.env,
    });
    killProcess(child.pid);
    await child.exited;
    expect(await processPath(child.pid)).toBeNull();
  });

  test("fora do Windows, o executável vem de /proc/<pid>/exe", async () => {
    expect(await processPath(42, "linux", (path) => `/real${path}`)).toBe("/real/proc/42/exe");
    const gone = () => {
      throw new Error("ENOENT");
    };
    expect(await processPath(42, "linux", gone)).toBeNull();
  });

  test("waitHealthy confere GET /health até o limite", async () => {
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ ok: true }) });
    cleanups.push(() => server.stop(true));
    expect(await waitHealthy(`http://127.0.0.1:${server.port}/health`, 1000, 10)).toBe(true);
    const down = Bun.serve({ port: 0, fetch: () => new Response("", { status: 500 }) });
    cleanups.push(() => down.stop(true));
    expect(await waitHealthy(`http://127.0.0.1:${down.port}/health`, 100, 10)).toBe(false);
    // Nothing listening at all.
    const closed = Bun.serve({ port: 0, fetch: () => new Response("") });
    const port = closed.port;
    await closed.stop(true);
    expect(await waitHealthy(`http://127.0.0.1:${port}/health`, 100, 10)).toBe(false);
  });

  test("swapBinary puts the new binary in place through a promise and keeps the previous one as .old", async () => {
    const dir = tempDir();
    const stable = join(dir, "bin", "flightdeckd");
    const fresh = join(dir, "fresh");
    writeFileSync(fresh, "new");
    const first = swapBinary(fresh, stable);
    expect(first).toBeInstanceOf(Promise);
    expect(await first).toBe(false);
    expect(readFileSync(stable, "utf8")).toBe("new");
    writeFileSync(fresh, "newer");
    expect(await swapBinary(fresh, stable)).toBe(true);
    expect(readFileSync(stable, "utf8")).toBe("newer");
    expect(readFileSync(`${stable}.old`, "utf8")).toBe("new");
  });
});
