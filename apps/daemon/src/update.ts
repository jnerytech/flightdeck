import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { PROTOCOL_VERSION } from "@flightdeck/protocol";
import { type HookTarget, hooksStatus, installHooks } from "./central/hooks-install.ts";
import type { Config } from "./config.ts";
import {
  installService,
  type ServiceContext,
  serviceCommand,
  startService,
  stopService,
} from "./service.ts";

/** What stopping the daemon of a service needs; the CLI gives the real pieces. */
export interface StopDeps {
  ctx: ServiceContext;
  /** True while a daemon holds the lock of `config.dataDir`. */
  daemonRunning(config: Config): boolean;
  /** Sends `daemon.shutdown`; true when the daemon took it. */
  shutdown?(config: Config): Promise<boolean>;
  /** The pid written in the lock of a `dataDir`. */
  lockPid?(dataDir: string): number | null;
  /** The executable a process runs, or null when it cannot be told. */
  processPath?(pid: number): Promise<string | null>;
  kill?(pid: number): void;
  /** How long the daemon may take to free the lock (10 s by default). */
  stopTimeoutMs?: number;
  log: { log(message: string): void; error(message: string): void };
}

export interface UpdateDeps extends StopDeps {
  /** The config given to the CLI (or the default one). */
  config: Config;
  /** Loads the service's own `--config`; absent when the CLI was given one. */
  configFromService?(path: string): Config;
  /** Version of this flightdeckd, the one being replaced. */
  currentVersion: string;
  /** Claude Code's settings, where `hooks install` writes. */
  settingsPath: string;
  stableBin: string;
  /** True once the daemon of `config` (on `port`) answers `GET /health`. */
  healthy(port: number, config: Config): Promise<boolean>;
  /** How long the new binary may take to answer `--version` (10 s by default). */
  versionTimeoutMs?: number;
}

/** Where `update` installs the daemon: `~/.flightdeck/bin/flightdeckd(.exe)`. */
export function stableBinPath(home: string, platform: string): string {
  return join(home, ".flightdeck", "bin", platform === "win32" ? "flightdeckd.exe" : "flightdeckd");
}

/** Compares `x.y.z` numerically. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Polls `url` until it answers 2xx or `timeoutMs` passes. */
export async function waitHealthy(url: string, timeoutMs: number, intervalMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(intervalMs * 10) })).ok) return true;
    } catch {
      // Not listening yet.
    }
    if (Date.now() >= deadline) return false;
    await Bun.sleep(intervalMs);
  }
}

const VERSION_LINE = /^flightdeckd (\d+\.\d+\.\d+)/;

/** What `<bin> --version` says, or null when it does not answer like flightdeckd in time. */
async function binaryVersion(bin: string, timeoutMs: number): Promise<string | null> {
  try {
    const proc = Bun.spawn([bin, "--version"], {
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
      env: process.env,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const done = await Promise.race([proc.exited.then(() => true), late]);
    clearTimeout(timer);
    if (!done) {
      proc.kill();
      return null;
    }
    return VERSION_LINE.exec(await new Response(proc.stdout).text())?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Paths compared as the OS does: case and slashes do not matter on Windows. */
const samePath = (a: string, b: string, platform: string) =>
  platform === "win32"
    ? a.replaceAll("/", "\\").toLowerCase() === b.replaceAll("/", "\\").toLowerCase()
    : a === b;

/** The file a path ends up at once links are followed; the path itself when it does not exist. */
function resolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

async function waitStopped(deps: StopDeps, config: Config): Promise<boolean> {
  const deadline = Date.now() + (deps.stopTimeoutMs ?? 10_000);
  while (deps.daemonRunning(config)) {
    if (Date.now() >= deadline) return false;
    await Bun.sleep(100);
  }
  return true;
}

/**
 * Stops the daemon of an installed service: `daemon.shutdown` first (Task Scheduler's `/End`
 * only ends `conhost.exe`), then the service, then waits for the lock. A lock still held is
 * killed only when its process runs `serviceExe`. False when the daemon is still there.
 */
export async function stopServiceDaemon(
  deps: StopDeps,
  config: Config,
  serviceExe: string,
): Promise<boolean> {
  if (await deps.shutdown?.(config)) deps.log.log("o daemon aceitou o pedido de desligamento");
  await stopService(deps.ctx);
  if (await waitStopped(deps, config)) return true;
  const pid = deps.lockPid?.(config.dataDir) ?? null;
  const path = pid !== null && deps.processPath ? await deps.processPath(pid) : null;
  // A package manager may put the executable behind a link: compare where both lead.
  const same = path !== null && samePath(resolved(path), resolved(serviceExe), deps.ctx.platform);
  if (pid === null || !same) {
    return false;
  }
  deps.kill?.(pid);
  deps.log.log(`processo ${pid} (${path}) do serviço encerrado à força`);
  return waitStopped(deps, config);
}

/** Hooks pointing somewhere else than the stable binary are written again; absent ones stay so. */
function updateHooks(deps: UpdateDeps, config: Config): void {
  const target: HookTarget = {
    command: [deps.stableBin],
    url: `http://127.0.0.1:${config.hooks.port}`,
    token: config.hooks.token ?? "",
    permissionTimeoutS: config.hooks.permissionTimeoutS,
    platform: deps.ctx.platform as NodeJS.Platform,
  };
  if (hooksStatus(deps.settingsPath, target) !== "outdated") return;
  installHooks(deps.settingsPath, target);
  deps.log.log(`hooks reinstalados apontando para ${deps.stableBin}`);
}

/**
 * `flightdeckd update --from <bin>`: checks the new binary, stops the service, swaps the stable
 * binary (keeping the previous one as `.old`), points service and hooks at it, starts it and
 * waits for `/health`. A daemon that does not come up gets the `.old` back. Returns the exit code.
 */
export async function runUpdate(
  opts: { from: string; allowDowngrade: boolean },
  deps: UpdateDeps,
): Promise<number> {
  const { log, ctx, stableBin } = deps;
  const version = await binaryVersion(opts.from, deps.versionTimeoutMs ?? 10_000);
  if (!version) {
    log.error(`${opts.from} não respondeu a --version como um flightdeckd`);
    return 1;
  }
  if (compareVersions(version, deps.currentVersion) < 0 && !opts.allowDowngrade) {
    log.error(
      `${opts.from} é a versão ${version}, mais antiga que a ${deps.currentVersion}: use --allow-downgrade para voltar`,
    );
    return 1;
  }
  const installed = await serviceCommand(ctx);
  // Without --config on the CLI, the service's own config says where its daemon lives.
  const config =
    installed?.config && deps.configFromService
      ? deps.configFromService(installed.config)
      : deps.config;
  if (installed === null && deps.daemonRunning(config)) {
    log.error("há um daemon rodando fora do serviço: pare o daemon e rode de novo");
    return 1;
  }
  const serviceExe = installed?.command[0] ?? stableBin;
  if (installed !== null && !(await stopServiceDaemon(deps, config, serviceExe))) {
    log.error("o daemon não parou depois de parar o serviço: pare-o e rode de novo");
    return 1;
  }

  const old = `${stableBin}.old`;
  const incoming = `${stableBin}.new`;
  mkdirSync(join(stableBin, ".."), { recursive: true });
  rmSync(old, { force: true });
  const hadPrevious = existsSync(stableBin);
  if (hadPrevious) renameSync(stableBin, old);
  copyFileSync(opts.from, incoming);
  chmodSync(incoming, 0o755);
  renameSync(incoming, stableBin);

  const reinstalled = installed !== null && !samePath(serviceExe, stableBin, ctx.platform);
  if (reinstalled) {
    // The service keeps the config it had.
    const result = await installService({ ...ctx, command: [stableBin] }, installed.config);
    log.log(`serviço reinstalado apontando para ${stableBin}`);
    for (const line of result.instructions) log.error(line);
  }
  updateHooks(deps, config);

  if (installed === null) {
    log.log(`flightdeckd ${deps.currentVersion} → ${version} instalado em ${stableBin}`);
    log.log(
      `nenhum serviço instalado: suba com "${stableBin}" start ou instale com "${stableBin}" service install`,
    );
    return 0;
  }
  await startService(ctx);
  if (await deps.healthy(config.port, config)) {
    log.log(`flightdeckd ${deps.currentVersion} → ${version} em ${stableBin}, respondendo`);
    return 0;
  }
  // Back to how it was: the previous binary (if any) and the service as it was installed.
  await stopServiceDaemon(deps, config, stableBin);
  rmSync(stableBin, { force: true });
  if (hadPrevious) renameSync(old, stableBin);
  if (reinstalled) {
    await installService({ ...ctx, command: installed.command }, installed.config);
    log.error(`serviço reinstalado de volta em ${serviceExe}`);
  }
  await startService(ctx);
  log.error(
    hadPrevious
      ? `o daemon ${version} não respondeu em /health: a versão anterior foi restaurada`
      : `o daemon ${version} não respondeu em /health; não havia versão anterior em ${stableBin}`,
  );
  return 1;
}

/**
 * Asks the daemon at `url` to shut down (`hello`, then `daemon.shutdown`). False when it is
 * not there, refuses the token, does not know the command or does not answer in `timeoutMs`.
 */
export function requestShutdown(url: string, token: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      ws.close();
      resolve(ok);
    };
    const timer = setTimeout(done, timeoutMs, false);
    const send = (id: string, type: string, payload: object) =>
      ws.send(JSON.stringify({ id, type, payload }));
    ws.addEventListener("open", () =>
      send("1", "hello", { token, client: "flightdeckd", protocolVersion: PROTOCOL_VERSION }),
    );
    ws.addEventListener("message", (msg) => {
      const frame = JSON.parse(String(msg.data)) as { type: string; id?: string; ok?: boolean };
      if (frame.type !== "ack") return;
      if (frame.ok && frame.id === "1") send("2", "daemon.shutdown", {});
      else done(frame.ok === true);
    });
    ws.addEventListener("close", () => done(false));
    ws.addEventListener("error", () => done(false));
  });
}
