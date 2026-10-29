import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { assertBinaryUntouched, installBinaryGuard } from "../../../scripts/test/binary-guard.ts";
import { hookEntries, installHooks } from "../src/central/hooks-install.ts";
import { Config } from "../src/config.ts";
import { acquireLock, readLockPid } from "../src/lock.ts";
import { runCli } from "../src/main.ts";
import { startServer } from "../src/server.ts";
import {
  type ServiceContext,
  serviceCommand,
  systemdUnit,
  windowsTaskXml,
} from "../src/service.ts";
import { killProcess, processPath } from "../src/service-os.ts";
import {
  compareVersions,
  requestShutdown,
  runUpdate,
  stableBinPath,
  type UpdateDeps,
  waitHealthy,
} from "../src/update.ts";
import { newManager, tempDir } from "./helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * A file that answers `--version` like flightdeckd; `null` answers something else and `"hang"`
 * never answers in time.
 */
function fakeBinary(version: string | null | "hang"): string {
  const dir = tempDir();
  const line = version ? `flightdeckd ${version} (protocolo 1)` : "outra coisa";
  if (process.platform === "win32") {
    const path = join(dir, "flightdeckd-novo.cmd");
    const body = version === "hang" ? "ping -n 3 127.0.0.1 >nul" : `echo ${line}`;
    writeFileSync(path, `@echo off\r\n${body}\r\n`);
    return path;
  }
  const path = join(dir, "flightdeckd-novo");
  writeFileSync(path, `#!/bin/sh\n${version === "hang" ? "sleep 2" : `echo "${line}"`}\n`);
  chmodSync(path, 0o755);
  return path;
}

/**
 * A service context that records commands and answers the query with a service installed at
 * `installed` (in our own task XML or unit format, with `config` as its --config), or with none.
 */
function fakeService(
  platform: "win32" | "linux",
  installed: string | string[] | null,
  config: string | null = null,
) {
  const calls: string[][] = [];
  const written: Record<string, string> = {};
  const user = platform === "win32" ? "PC\\dev" : "dev";
  const ctx: ServiceContext = {
    platform,
    home: tempDir(),
    user,
    command: [],
    systemRoot: "C:\\Windows",
    tempDir: tempDir(),
    dryRun: false,
    exec: async (cmd) => {
      calls.push(cmd);
      const query = cmd[1] === "/Query" || cmd[2] === "cat";
      if (query && !installed) return { code: 1, stdout: "" };
      if (query && installed) {
        const command = typeof installed === "string" ? [installed] : installed;
        const stdout =
          platform === "win32"
            ? windowsTaskXml(command, { user, systemRoot: "C:\\Windows", config })
            : `# ${ctx.home}/.config/systemd/user/flightdeckd.service\n${systemdUnit(command, config)}`;
        return { code: 0, stdout };
      }
      return { code: 0, stdout: "" };
    },
    writeFile: (path, content) => {
      written[path] = content;
    },
    removeFile: () => {},
    which: () => null,
  };
  return { ctx, calls, written };
}

const DIST_WIN = "D:\\repos\\flightdeck\\dist\\flightdeckd-windows-x64.exe";
const DIST_LINUX = "/home/dev/flightdeck/dist/flightdeckd-linux-x64";

function setup(
  platform: "win32" | "linux",
  installed: string | null,
  extra: { healthy?: boolean; running?: boolean; serviceConfig?: string } = {},
) {
  const service = fakeService(platform, installed, extra.serviceConfig ?? null);
  const stable = stableBinPath(service.ctx.home, platform);
  const settingsPath = join(tempDir(), ".claude", "settings.json");
  const out: string[] = [];
  const config = Config.parse({
    token: "t".repeat(32),
    port: 7420,
    dataDir: tempDir(),
    hooks: { port: 7421, token: "h".repeat(20) },
  });
  const healthChecks: number[] = [];
  const deps: UpdateDeps = {
    config,
    ctx: service.ctx,
    currentVersion: "0.7.0",
    settingsPath,
    stableBin: stable,
    healthy: async (port: number) => {
      healthChecks.push(port);
      return extra.healthy ?? true;
    },
    daemonRunning: () => extra.running ?? false,
    stopTimeoutMs: 50,
    versionTimeoutMs: 5_000,
    log: { log: (m: string) => out.push(m), error: (m: string) => out.push(m) },
  };
  return { ...service, stable, settingsPath, out, deps, healthChecks };
}

const update = (deps: UpdateDeps, from: string, allowDowngrade = false) =>
  runUpdate({ from, allowDowngrade }, deps);

/** The installed binary from an earlier version. */
function previous(stable: string) {
  mkdirSync(dirname(stable), { recursive: true });
  writeFileSync(stable, "versão antiga");
}

describe("update", () => {
  test("caminho estável: ~/.flightdeck/bin/flightdeckd, .exe no Windows; versões comparadas por número", () => {
    expect(stableBinPath("C:\\Users\\dev", "win32")).toBe(
      join("C:\\Users\\dev", ".flightdeck", "bin", "flightdeckd.exe"),
    );
    expect(stableBinPath("/home/dev", "linux")).toBe(
      join("/home/dev", ".flightdeck", "bin", "flightdeckd"),
    );
    expect(compareVersions("0.8.0", "0.7.0")).toBeGreaterThan(0);
    expect(compareVersions("0.7.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  test("o comando e a config do serviço instalado saem da tarefa ou da unit", async () => {
    const spaced = "C:\\Program Files\\flightdeck\\flightdeckd.exe";
    expect(await serviceCommand(fakeService("win32", spaced).ctx)).toEqual({
      command: [spaced],
      config: null,
    });
    expect(
      await serviceCommand(
        fakeService("win32", DIST_WIN, "C:\\Users\\dev\\meu fd\\config.json").ctx,
      ),
    ).toEqual({ command: [DIST_WIN], config: "C:\\Users\\dev\\meu fd\\config.json" });
    expect(await serviceCommand(fakeService("linux", DIST_LINUX, "/etc/fd.json").ctx)).toEqual({
      command: [DIST_LINUX],
      config: "/etc/fd.json",
    });
    const quoted = "/home/dev/meu flightdeck/flightdeckd";
    expect(await serviceCommand(fakeService("linux", quoted, "/home/dev/a b/c.json").ctx)).toEqual({
      command: [quoted],
      config: "/home/dev/a b/c.json",
    });
    // From the source tree, the service runs bun with the entry point.
    const dev = ["C:\\bun\\bun.exe", "run", "D:\\repos\\flightdeck\\apps\\daemon\\src\\bin.ts"];
    expect(await serviceCommand(fakeService("win32", dev).ctx)).toEqual({
      command: dev,
      config: null,
    });
    expect(await serviceCommand(fakeService("linux", null).ctx)).toBeNull();
    expect(await serviceCommand(fakeService("win32", null).ctx)).toBeNull();
  });

  test("recusa binário sem --version válido e downgrade sem a flag", async () => {
    const { deps, out, calls, stable } = setup("win32", DIST_WIN);
    expect(await update(deps, fakeBinary(null))).toBe(1);
    expect(out.join("\n")).toContain("não respondeu a --version");
    expect(await update(deps, join(tempDir(), "nao-existe"))).toBe(1);
    expect(await update({ ...deps, versionTimeoutMs: 100 }, fakeBinary("hang"))).toBe(1);
    expect(await update(deps, fakeBinary("0.6.0"))).toBe(1);
    expect(out.join("\n")).toContain("--allow-downgrade");
    expect(calls).toEqual([]);
    expect(existsSync(stable)).toBe(false);
    expect(await update(deps, fakeBinary("0.6.0"), true)).toBe(0);
  });

  test("recusa com um daemon rodando sem serviço", async () => {
    const { deps, out, stable } = setup("win32", null, { running: true });
    expect(await update(deps, fakeBinary("0.8.0"))).toBe(1);
    expect(out.join("\n")).toContain("pare o daemon e rode de novo");
    expect(existsSync(stable)).toBe(false);
  });

  test("serviço parado que não solta o daemon: nada é trocado", async () => {
    const { deps, out, calls, stable } = setup("win32", DIST_WIN, { running: true });
    previous(stable);
    expect(await update(deps, fakeBinary("0.8.0"))).toBe(1);
    expect(out.join("\n")).toContain("o daemon não parou");
    expect(readFileSync(stable, "utf8")).toBe("versão antiga");
    expect(calls.map((c) => c[1])).toEqual(["/Query", "/End"]);
  });

  test("Windows: para a tarefa, troca o binário guardando o .old, reinstala no caminho estável, sobe e confere /health", async () => {
    const { deps, out, calls, written, stable, healthChecks } = setup("win32", DIST_WIN);
    previous(stable);
    const from = fakeBinary("0.8.0");
    expect(await update(deps, from)).toBe(0);
    expect(calls.map((c) => c[1])).toEqual(["/Query", "/End", "/Create", "/Run"]);
    expect(readFileSync(stable, "utf8")).toBe(readFileSync(from, "utf8"));
    expect(readFileSync(`${stable}.old`, "utf8")).toBe("versão antiga");
    expect(Object.values(written).join("\n")).toContain(stable);
    expect(healthChecks).toEqual([7420]);
    const text = out.join("\n");
    expect(text).toContain(`serviço reinstalado apontando para ${stable}`);
    expect(text).toContain("0.7.0 → 0.8.0");
    // The next update replaces the .old left by the previous success.
    expect(await update(deps, fakeBinary("0.9.0"))).toBe(0);
    expect(readFileSync(`${stable}.old`, "utf8")).toBe(readFileSync(from, "utf8"));
  });

  test("Linux: unit reescrita no caminho estável; serviço já no caminho estável não é reinstalado", async () => {
    const first = setup("linux", DIST_LINUX);
    expect(await update(first.deps, fakeBinary("0.8.0"))).toBe(0);
    expect(Object.values(first.written)).toEqual([systemdUnit([first.stable])]);
    expect(first.calls.map((c) => c.join(" "))).toEqual([
      "systemctl --user cat flightdeckd",
      "systemctl --user stop flightdeckd",
      "systemctl --user daemon-reload",
      "systemctl --user enable --now flightdeckd",
      "loginctl show-user dev -p Linger",
      "systemctl --user start flightdeckd",
    ]);
    const kept = setup("linux", null);
    const installed = setup("linux", kept.stable);
    installed.deps.stableBin = kept.stable;
    expect(await update(installed.deps, fakeBinary("0.8.0"))).toBe(0);
    expect(installed.calls.map((c) => c[2])).toEqual(["cat", "stop", "start"]);
    expect(installed.out.join("\n")).not.toContain("serviço reinstalado");
  });

  test("daemon novo que não responde: volta o .old e o serviço original, sobe de novo e sai com 1", async () => {
    const svcConfig = "C:\\fd\\config.json";
    const { deps, out, calls, written, stable } = setup("win32", DIST_WIN, {
      healthy: false,
      serviceConfig: svcConfig,
    });
    previous(stable);
    expect(await update(deps, fakeBinary("0.8.0"))).toBe(1);
    expect(readFileSync(stable, "utf8")).toBe("versão antiga");
    expect(existsSync(`${stable}.old`)).toBe(false);
    expect(calls.map((c) => c[1])).toEqual([
      "/Query",
      "/End",
      "/Create",
      "/Run",
      "/End",
      "/Create",
      "/Run",
    ]);
    // The task runs what it ran before, with the same config.
    expect(Object.values(written).join("\n")).toContain(
      `"${DIST_WIN}" start --config ${svcConfig}</Arguments>`,
    );
    expect(out.join("\n")).toContain("versão anterior foi restaurada");
    expect(out.join("\n")).toContain(`serviço reinstalado de volta em ${DIST_WIN}`);
  });

  test("primeiro update que falha: sem binário anterior, o serviço volta ao caminho original e sobe", async () => {
    const svcConfig = "/home/dev/fd/config.json";
    const fresh = setup("linux", DIST_LINUX, { healthy: false, serviceConfig: svcConfig });
    expect(await update(fresh.deps, fakeBinary("0.8.0"))).toBe(1);
    expect(existsSync(fresh.stable)).toBe(false);
    expect(Object.values(fresh.written)).toEqual([systemdUnit([DIST_LINUX], svcConfig)]);
    expect(fresh.calls.at(-1)?.join(" ")).toBe("systemctl --user start flightdeckd");
    expect(fresh.out.join("\n")).toContain(`serviço reinstalado de volta em ${DIST_LINUX}`);
  });

  test("reinstala no caminho estável mantendo o --config do serviço; sem --config no CLI, a porta do /health vem dele", async () => {
    const svcConfig = "C:\\fd\\config.json";
    const win = setup("win32", DIST_WIN, { serviceConfig: svcConfig });
    const loaded: string[] = [];
    win.deps.configFromService = (path) => {
      loaded.push(path);
      return Config.parse({ token: "s".repeat(32), port: 7555, dataDir: tempDir() });
    };
    expect(await update(win.deps, fakeBinary("0.8.0"))).toBe(0);
    expect(Object.values(win.written).join("\n")).toContain(
      `"${win.stable}" start --config ${svcConfig}</Arguments>`,
    );
    expect(loaded).toEqual([svcConfig]);
    expect(win.healthChecks).toEqual([7555]);
    // With --config on the CLI (no loader), that config decides the port.
    const explicit = setup("linux", DIST_LINUX, { serviceConfig: "/etc/fd.json" });
    expect(await update(explicit.deps, fakeBinary("0.8.0"))).toBe(0);
    expect(Object.values(explicit.written)).toEqual([
      systemdUnit([explicit.stable], "/etc/fd.json"),
    ]);
    expect(explicit.healthChecks).toEqual([7420]);
  });

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
    expect(await requestShutdown(server.url, "x".repeat(32), 2000)).toBe(false);
    const closed = Bun.serve({ port: 0, fetch: () => new Response("") });
    const port = closed.port;
    await closed.stop(true);
    expect(await requestShutdown(`ws://127.0.0.1:${port}/v1/ws`, token, 500)).toBe(false);
    expect(asked).toBe(1);

    const dataDir = tempDir();
    expect(readLockPid(dataDir)).toBeNull();
    const lock = acquireLock(dataDir);
    cleanups.push(() => lock?.release());
    expect(readLockPid(dataDir)).toBe(process.pid);

    // Paths compared after links are resolved (a package manager may install bun behind one).
    const own = await processPath(process.pid);
    expect(realpathSync(own ?? "")).toBe(realpathSync(process.execPath));
    const child = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
      env: process.env,
    });
    killProcess(child.pid);
    await child.exited;
    expect(await processPath(child.pid)).toBeNull();
  });

  test("CLI sem --config: usa a config do serviço para o /health", async () => {
    const hits: string[] = [];
    const daemon = Bun.serve({
      port: 0,
      fetch: (req) => {
        hits.push(new URL(req.url).pathname);
        return Response.json({ ok: true });
      },
    });
    cleanups.push(() => daemon.stop(true));
    const config = join(tempDir(), "config.json");
    writeFileSync(
      config,
      JSON.stringify({ token: "t".repeat(32), dataDir: tempDir(), port: daemon.port }),
    );
    const service = fakeService("win32", DIST_WIN, config);
    let code = null as number | null;
    await runCli(["update", "--from", fakeBinary("0.8.0")], {
      env: {},
      log: { log: () => {}, error: () => {} },
      exit: (c) => {
        code = c;
      },
      onSignal: () => {},
      serviceContext: () => service.ctx,
    });
    expect(code).toBe(0);
    // First the daemon.shutdown attempt on the WebSocket, then the health check.
    expect(hits).toEqual(["/v1/ws", "/health"]);
  }, 40_000);

  test("hooks instalados fora do caminho estável são reinstalados; sem hooks, nada é escrito", async () => {
    const withHooks = setup("win32", DIST_WIN);
    const target = {
      command: [DIST_WIN],
      url: "http://127.0.0.1:7421",
      token: "h".repeat(20),
      permissionTimeoutS: 600,
      platform: "win32" as const,
    };
    installHooks(withHooks.settingsPath, target);
    expect(await update(withHooks.deps, fakeBinary("0.8.0"))).toBe(0);
    const settings = JSON.parse(readFileSync(withHooks.settingsPath, "utf8"));
    expect(settings.hooks.SessionStart).toEqual(
      hookEntries({ ...target, command: [withHooks.stable] }).SessionStart,
    );
    expect(withHooks.out.join("\n")).toContain(
      `hooks reinstalados apontando para ${withHooks.stable}`,
    );
    // Already on the stable path: left alone.
    const before = readFileSync(withHooks.settingsPath, "utf8");
    withHooks.out.length = 0;
    expect(await update(withHooks.deps, fakeBinary("0.9.0"))).toBe(0);
    expect(readFileSync(withHooks.settingsPath, "utf8")).toBe(before);
    expect(withHooks.out.join("\n")).not.toContain("hooks reinstalados");
    const without = setup("win32", DIST_WIN);
    expect(await update(without.deps, fakeBinary("0.8.0"))).toBe(0);
    expect(existsSync(without.settingsPath)).toBe(false);
  });

  test("sem serviço e sem daemon: só instala o binário e diz como subir", async () => {
    const { deps, out, calls, stable, healthChecks } = setup("win32", null);
    expect(await update(deps, fakeBinary("0.8.0"))).toBe(0);
    expect(existsSync(stable)).toBe(true);
    expect(calls.map((c) => c[1])).toEqual(["/Query"]);
    expect(healthChecks).toEqual([]);
    expect(out.join("\n")).toContain("nenhum serviço instalado");
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

  test("CLI: flightdeckd update --from instala no ~/.flightdeck/bin do contexto de serviço", async () => {
    const service = fakeService("win32", null);
    const config = join(tempDir(), "config.json");
    writeFileSync(config, JSON.stringify({ token: "t".repeat(32), dataDir: tempDir() }));
    const run = async (args: string[]) => {
      const out: string[] = [];
      let code = null as number | null;
      await runCli(args, {
        env: {},
        log: { log: (m) => out.push(m), error: (m) => out.push(m) },
        exit: (c) => {
          code = c;
        },
        onSignal: () => {},
        serviceContext: () => service.ctx,
      });
      return { code, out: out.join("\n") };
    };
    const from = fakeBinary("0.6.0");
    const refused = await run(["update", "--from", from, "--config", config]);
    expect(refused.code).toBe(1);
    const done = await run(["update", "--from", from, "--allow-downgrade", "--config", config]);
    expect(done.code).toBe(0);
    expect(existsSync(stableBinPath(service.ctx.home, "win32"))).toBe(true);
    const missing = await run(["update", "--config", config]);
    expect(missing.code).toBe(1);
    expect(missing.out).toContain("update precisa de --from");
  });

  test("CLI: com serviço, confere GET /health no endereço da config", async () => {
    const hits: string[] = [];
    const daemon = Bun.serve({
      port: 0,
      fetch: (req) => {
        hits.push(new URL(req.url).pathname);
        return Response.json({ ok: true });
      },
    });
    cleanups.push(() => daemon.stop(true));
    const service = fakeService("win32", DIST_WIN);
    const config = join(tempDir(), "config.json");
    writeFileSync(
      config,
      JSON.stringify({
        token: "t".repeat(32),
        dataDir: tempDir(),
        bind: "127.0.0.1",
        port: daemon.port,
      }),
    );
    let code = null as number | null;
    await runCli(["update", "--from", fakeBinary("0.8.0"), "--config", config], {
      env: {},
      log: { log: () => {}, error: () => {} },
      exit: (c) => {
        code = c;
      },
      onSignal: () => {},
      serviceContext: () => service.ctx,
    });
    expect(code).toBe(0);
    expect(service.calls.map((c) => c[1])).toEqual(["/Query", "/End", "/Create", "/Run"]);
    expect(hits).toEqual(["/v1/ws", "/health"]);
  });

  test("trava do binário: o preload reprova se o flightdeckd estável do home real mudar", () => {
    const home = tempDir();
    const guard = installBinaryGuard(home);
    expect(() => assertBinaryUntouched(guard)).not.toThrow();
    const stable = stableBinPath(home, process.platform);
    previous(stable);
    expect(() => assertBinaryUntouched(guard)).toThrow("binário real do flightdeckd mexido");
  });
});
