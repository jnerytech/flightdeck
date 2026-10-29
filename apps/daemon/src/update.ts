import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type HookTarget, hooksStatus, installHooks } from "./central/hooks-install.ts";
import type { Config } from "./config.ts";
import {
  installService,
  type ServiceContext,
  serviceCommandPath,
  startService,
  stopService,
} from "./service.ts";

export interface UpdateDeps {
  config: Config;
  ctx: ServiceContext;
  /** Version of this flightdeckd, the one being replaced. */
  currentVersion: string;
  /** Claude Code's settings, where `hooks install` writes. */
  settingsPath: string;
  stableBin: string;
  /** True once the daemon on `port` answers `GET /health`. */
  healthy(port: number): Promise<boolean>;
  /** True while a daemon holds the lock of `config.dataDir`. */
  daemonRunning(): boolean;
  /** How long a stopped service may take to free the lock (10 s by default). */
  stopTimeoutMs?: number;
  /** How long the new binary may take to answer `--version` (10 s by default). */
  versionTimeoutMs?: number;
  log: { log(message: string): void; error(message: string): void };
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

async function waitStopped(deps: UpdateDeps): Promise<boolean> {
  const deadline = Date.now() + (deps.stopTimeoutMs ?? 10_000);
  while (deps.daemonRunning()) {
    if (Date.now() >= deadline) return false;
    await Bun.sleep(100);
  }
  return true;
}

/** Hooks pointing somewhere else than the stable binary are written again; absent ones stay so. */
function updateHooks(deps: UpdateDeps): void {
  const target: HookTarget = {
    command: [deps.stableBin],
    url: `http://127.0.0.1:${deps.config.hooks.port}`,
    token: deps.config.hooks.token ?? "",
    permissionTimeoutS: deps.config.hooks.permissionTimeoutS,
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
  const installed = await serviceCommandPath(ctx);
  if (installed === null && deps.daemonRunning()) {
    log.error("há um daemon rodando fora do serviço: pare o daemon e rode de novo");
    return 1;
  }
  if (installed !== null) {
    await stopService(ctx);
    if (!(await waitStopped(deps))) {
      log.error("o daemon não parou depois de parar o serviço: pare-o e rode de novo");
      return 1;
    }
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

  if (installed !== null && !samePath(installed, stableBin, ctx.platform)) {
    const result = await installService({ ...ctx, command: [stableBin] });
    log.log(`serviço reinstalado apontando para ${stableBin}`);
    for (const line of result.instructions) log.error(line);
  }
  updateHooks(deps);

  if (installed === null) {
    log.log(`flightdeckd ${deps.currentVersion} → ${version} instalado em ${stableBin}`);
    log.log(
      `nenhum serviço instalado: suba com "${stableBin}" start ou instale com "${stableBin}" service install`,
    );
    return 0;
  }
  await startService(ctx);
  if (await deps.healthy(deps.config.port)) {
    log.log(`flightdeckd ${deps.currentVersion} → ${version} em ${stableBin}, respondendo`);
    return 0;
  }
  await stopService(ctx);
  if (!hadPrevious) {
    log.error(
      `o daemon novo não respondeu em /health e não havia versão anterior em ${stableBin} para restaurar`,
    );
    return 1;
  }
  rmSync(stableBin, { force: true });
  renameSync(old, stableBin);
  await startService(ctx);
  log.error(`o daemon ${version} não respondeu em /health: a versão anterior foi restaurada`);
  return 1;
}
