/**
 * The host operation commands of the command line (issue #1593): `flightdeckd service` and
 * `flightdeckd update`, over the service and update modules of the host.
 */

import { resolve } from "node:path";
import { type Config, claudeSettingsPath, loadConfig, updateConfigFile } from "../config.ts";
import { acquireLock, DAEMON_VERSION, type Logger, readLockPid } from "../kernel/index.ts";
import { daemonUrl } from "../mcp.ts";
import {
  binDir,
  installService,
  killProcess,
  osServiceContext,
  processPath,
  removeFromUserPath,
  requestShutdown,
  resolveServiceClaude,
  runUpdate,
  type ServiceCommand,
  type ServiceContext,
  type StopDeps,
  serviceCommand,
  serviceStatus,
  stableBinPath,
  startService,
  stopServiceDaemon,
  uninstallService,
  waitHealthy,
} from "../service/index.ts";
import { type CliArgs, configPath } from "./args.ts";

/** What the service and update commands need of the command line's deps (main.ts's `CliDeps`). */
export interface HostCommandDeps {
  log: Logger;
  serviceContext?: (dryRun: boolean) => ServiceContext;
  /** How long `service uninstall` waits for the daemon to free its lock (10 s when absent). */
  serviceStopTimeoutMs?: number;
  /** How long `service start` waits for `/health` (30 s when absent). */
  serviceHealthTimeoutMs?: number;
}

function printResult(
  deps: HostCommandDeps,
  result: { output: string[]; instructions: string[] },
): void {
  for (const line of result.output) deps.log.log(line);
  for (const line of result.instructions) deps.log.error(line);
}

/** The config of the installed service: `--config` on the CLI, else the service's own one. */
const serviceConfig = (args: CliArgs, installed: ServiceCommand) =>
  loadConfig(args.config ? configPath(args) : (installed.config ?? configPath(args)));

/** Where a daemon of `config` answers `GET /health`. */
export const healthUrl = (config: Config) =>
  new URL("/health", daemonUrl(config).replace(/^ws:/, "http:")).href;

/**
 * Stops the daemon of the installed service (`daemon.shutdown`, the task or unit, the lock).
 * Null without a service; false when the daemon is still there.
 */
export async function stopInstalledDaemon(
  args: CliArgs,
  ctx: ServiceContext,
  deps: HostCommandDeps,
): Promise<boolean | null> {
  const installed = await serviceCommand(ctx);
  if (!installed) return null;
  const stop = {
    ...serviceStopDeps(ctx, deps.log),
    ...(deps.serviceStopTimeoutMs ? { stopTimeoutMs: deps.serviceStopTimeoutMs } : {}),
  };
  return stopServiceDaemon(
    stop,
    await serviceConfig(args, installed),
    installed.command[0] as string,
  );
}

/** `service stop`: the daemon goes, the task or unit stays installed. */
async function stopService(
  args: CliArgs,
  ctx: ServiceContext,
  deps: HostCommandDeps,
): Promise<void> {
  const stopped = await stopInstalledDaemon(args, ctx, deps);
  if (stopped === null) throw new Error("no service installed");
  if (!stopped) throw new Error("the service's daemon did not stop: stop it by hand");
  deps.log.log("the service's daemon stopped (the service stays installed)");
}

/** `service start`: runs the task or unit and waits for `/health` of the service's config. */
async function startInstalledService(
  args: CliArgs,
  ctx: ServiceContext,
  deps: HostCommandDeps,
): Promise<void> {
  const installed = await serviceCommand(ctx);
  if (!installed) throw new Error("no service installed");
  const url = healthUrl(await serviceConfig(args, installed));
  await startService(ctx);
  if (!(await waitHealthy(url, deps.serviceHealthTimeoutMs ?? 30_000, 250))) {
    throw new Error(`the service's daemon did not answer on /health (${url})`);
  }
  deps.log.log(`the service's daemon is answering on ${url}`);
}

type ServiceContextOf = ReturnType<NonNullable<HostCommandDeps["serviceContext"]>>;

async function uninstallInstalledService(
  args: CliArgs,
  ctx: ServiceContextOf,
  deps: HostCommandDeps,
): Promise<void> {
  // Removing the task or unit alone would leave the daemon running: it goes first.
  if (!ctx.dryRun && (await stopInstalledDaemon(args, ctx, deps)) === false) {
    deps.log.error("warning: the service's daemon is still running; stop it by hand");
  }
  printResult(deps, await uninstallService(ctx));
  if (ctx.dryRun) {
    if (ctx.platform === "win32") deps.log.log(`# ${binDir(ctx)} would leave the user Path`);
    return;
  }
  for (const line of await removeFromUserPath(ctx, binDir(ctx))) deps.log.log(line);
}

/** Writes the `claude` the service found into the config (or says it would, in a dry run). */
async function recordServiceClaude(
  file: string,
  claude: ReturnType<typeof resolveServiceClaude>,
  ctx: ServiceContextOf,
  deps: HostCommandDeps,
): Promise<void> {
  if (ctx.dryRun) {
    if (claude.path) {
      deps.log.log(`claude.executablePath = "${claude.path}" (would be written to ${file})`);
    }
    return;
  }
  await loadConfig(file);
  const executablePath = claude.path;
  if (executablePath) {
    await updateConfigFile(file, (raw) => ({
      ...raw,
      claude: { ...(raw.claude as object), executablePath },
    }));
  }
}

/**
 * `flightdeckd service install|uninstall|status`. With `--dry-run` nothing is written, not even
 * the config, so `loadConfig` (which creates a missing file) is never called in that mode.
 */
export async function runService(args: CliArgs, deps: HostCommandDeps): Promise<void> {
  const ctx = (deps.serviceContext ?? osServiceContext)(args.dryRun === true);
  if (args.action === "status") return printResult(deps, await serviceStatus(ctx));
  if (args.action === "stop") return stopService(args, ctx, deps);
  if (args.action === "start") return startInstalledService(args, ctx, deps);
  if (args.action === "uninstall") return uninstallInstalledService(args, ctx, deps);
  const file = configPath(args);
  const claude = resolveServiceClaude(ctx);
  if (claude.warning) deps.log.error(claude.warning);
  await recordServiceClaude(file, claude, ctx, deps);
  // The service only gets --config when the user gave one, always as an absolute path.
  printResult(deps, await installService(ctx, args.config ? resolve(args.config) : null));
  if (ctx.dryRun) return;
  // The Windows task only has a logon trigger and systemd may be slow: start it now and check.
  if (ctx.platform === "win32") await startService(ctx);
  const url = healthUrl(await loadConfig(file));
  if (!(await waitHealthy(url, deps.serviceHealthTimeoutMs ?? 30_000, 250))) {
    throw new Error(`the service's daemon did not answer on /health (${url})`);
  }
  deps.log.log(`the service's daemon is answering on ${url}`);
}

/** The real pieces that stop the daemon of a service: shutdown request, lock and process. */
function serviceStopDeps(ctx: ServiceContext, log: Logger): StopDeps {
  return {
    ctx,
    log,
    daemonRunning: async (config) => {
      const lock = await acquireLock(config.dataDir);
      await lock?.release();
      return lock === null;
    },
    shutdown: (config) => requestShutdown(daemonUrl(config), config.token, 3_000),
    lockPid: readLockPid,
    processPath,
    kill: killProcess,
  };
}

/** `flightdeckd update --from <binary>`: the binary in the stable path, service and hooks on it. */
export async function runUpdateCommand(args: CliArgs, deps: HostCommandDeps): Promise<number> {
  if (!args.from) throw new Error("update needs --from <new binary>");
  const ctx = (deps.serviceContext ?? osServiceContext)(false);
  return runUpdate(
    { from: args.from, allowDowngrade: args.allowDowngrade === true },
    {
      ...serviceStopDeps(ctx, deps.log),
      // Read only when used: a service with its own --config never loads the default one.
      get config() {
        return loadConfig(configPath(args));
      },
      ...(args.config ? {} : { configFromService: (path: string) => loadConfig(path) }),
      currentVersion: DAEMON_VERSION,
      settingsPath: claudeSettingsPath(),
      stableBin: stableBinPath(ctx.home, ctx.platform),
      healthy: (_port, config) => waitHealthy(healthUrl(config), 30_000, 250),
    },
  );
}
