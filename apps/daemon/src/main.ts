import { join, resolve } from "node:path";
import { claudeVersionProbe } from "./claude-probe.ts";
import {
  defaultConfigPath,
  expandHome,
  loadConfig,
  RuntimeKind,
  updateConfigFile,
} from "./config.ts";
import { spawnExec } from "./exec.ts";
import { acquireLock } from "./lock.ts";
import { FakeRuntime } from "./runtime/fake-runtime.ts";
import type { AgentRuntime } from "./runtime/types.ts";
import { DAEMON_VERSION, startServer } from "./server.ts";
import {
  installService,
  resolveServiceClaude,
  type ServiceContext,
  serviceStatus,
  uninstallService,
} from "./service.ts";
import { osServiceContext } from "./service-os.ts";
import { SessionManager } from "./sessions/session-manager.ts";
import { EventStore } from "./store/event-store.ts";
import { type WslItem, WslSupervisor } from "./wsl.ts";

export type ServiceAction = "install" | "uninstall" | "status";

export interface CliArgs {
  command: "start" | "service";
  /** `service <action>`. */
  action?: ServiceAction;
  /** `service ... --dry-run`: print, change nothing. */
  dryRun?: true;
  config?: string;
  runtime?: RuntimeKind;
}

const USAGE = [
  "uso: flightdeckd [start] [--config <arquivo>] [--runtime fake|claude]",
  "     flightdeckd service install|uninstall|status [--dry-run] [--config <arquivo>]",
].join("\n");

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { command: "start" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const [flag, inline] = arg.startsWith("--") ? arg.split("=", 2) : [arg, undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined || v.startsWith("--"))
        throw new Error(`${flag} precisa de um valor\n${USAGE}`);
      return v;
    };
    switch (flag) {
      case "start":
        break;
      case "service": {
        args.command = "service";
        const action = argv[++i];
        if (action !== "install" && action !== "uninstall" && action !== "status") {
          throw new Error(`ação de serviço inválida: ${action ?? "(nenhuma)"}\n${USAGE}`);
        }
        args.action = action;
        break;
      }
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--config":
        args.config = value();
        break;
      case "--runtime":
        args.runtime = RuntimeKind.parse(value());
        break;
      default:
        throw new Error(`argumento desconhecido: ${arg}\n${USAGE}`);
    }
  }
  return args;
}

/** Exit code when another daemon already owns the same `dataDir`. */
export const EXIT_ALREADY_RUNNING = 3;

export class AlreadyRunningError extends Error {
  constructor(dataDir: string) {
    super(`já em execução (dataDir ${dataDir})`);
  }
}

export interface Logger {
  log(message: string): void;
  error(message: string): void;
}

export interface Daemon {
  url: string;
  runtime: AgentRuntime;
  stop(): Promise<void>;
}

interface CreatedRuntime {
  runtime: AgentRuntime;
  /** What `host.info` reports about `claude`; only the real runtime has one. */
  claude?: { path: string | null; version(): Promise<string | null> };
}

async function createRuntime(kind: RuntimeKind, claudePath?: string): Promise<CreatedRuntime> {
  if (kind === "fake") return { runtime: new FakeRuntime() };
  const { ClaudeSdkRuntime } = await import("./runtime/claude-sdk-runtime.ts");
  const runtime = new ClaudeSdkRuntime(claudePath ? { claudePath } : {});
  const path = runtime.claudePath ?? null;
  return { runtime, claude: { path, version: claudeVersionProbe(path, spawnExec) } };
}

/** Loads the config, opens the store and starts serving. The token is never logged. */
export async function startDaemon(
  args: CliArgs,
  env: Record<string, string | undefined>,
  logger: Logger,
  options: { wslCommand?: (item: WslItem) => string[] } = {},
): Promise<Daemon> {
  const config = loadConfig(args.config);
  const runtimeKind = args.runtime ?? config.runtime;
  // Before SQLite and the port: a second daemon must not touch either.
  const lock = acquireLock(config.dataDir);
  if (!lock) throw new AlreadyRunningError(config.dataDir);
  const store = new EventStore(join(config.dataDir, "flightdeck.db"));
  const claudePath = config.claude?.executablePath ?? config.claudePath;
  const { runtime, claude } = await createRuntime(runtimeKind, claudePath);
  const manager = new SessionManager({
    store,
    runtime,
    allowedRoots: config.allowedRoots,
    defaultPermissionMode: config.defaultPermissionMode,
    allowApiKey: config.allowApiKey,
    baseEnv: env,
  });
  const server = startServer({
    manager,
    hostName: config.hostName,
    bind: config.bind,
    port: config.port,
    token: config.token,
    allowedRoots: config.allowedRoots,
    allowedNetworks: config.allowedNetworks,
    ...(claude ? { claude } : {}),
  });

  const wsl =
    config.wsl.length > 0
      ? new WslSupervisor(config.wsl, {
          logDir: join(config.dataDir, "logs"),
          ...(options.wslCommand ? { command: options.wslCommand } : {}),
        })
      : null;
  wsl?.start();

  logger.log(`flightdeckd ${DAEMON_VERSION} listening on ${server.url} (runtime=${runtimeKind})`);
  if (config.allowedRoots.length === 0) {
    logger.error("aviso: allowedRoots está vazio; nenhuma sessão poderá ser criada");
  }

  let stopped: Promise<void> | null = null;
  return {
    url: server.url,
    runtime,
    stop: () => {
      stopped ??= (async () => {
        await wsl?.stop();
        await manager.shutdown();
        await server.stop();
        store.close();
        lock.release();
      })();
      return stopped;
    },
  };
}

function configPath(args: CliArgs): string {
  return resolve(expandHome(args.config ?? defaultConfigPath()));
}

/**
 * `flightdeckd service install|uninstall|status`. With `--dry-run` nothing is written, not even
 * the config, so `loadConfig` (which creates a missing file) is never called in that mode.
 */
async function runService(args: CliArgs, deps: CliDeps): Promise<void> {
  const ctx = (deps.serviceContext ?? osServiceContext)(args.dryRun === true);
  if (args.action === "status") return printResult(deps, await serviceStatus(ctx));
  if (args.action === "uninstall") return printResult(deps, await uninstallService(ctx));
  const file = configPath(args);
  const claude = resolveServiceClaude(ctx);
  if (claude.warning) deps.log.error(claude.warning);
  if (ctx.dryRun) {
    if (claude.path) {
      deps.log.log(`claude.executablePath = "${claude.path}" (seria gravado em ${file})`);
    }
  } else {
    loadConfig(file);
    const executablePath = claude.path;
    if (executablePath) {
      updateConfigFile(file, (raw) => ({
        ...raw,
        claude: { ...(raw.claude as object), executablePath },
      }));
    }
  }
  printResult(deps, await installService(ctx));
}

function printResult(deps: CliDeps, result: { output: string[]; instructions: string[] }): void {
  for (const line of result.output) deps.log.log(line);
  for (const line of result.instructions) deps.log.error(line);
}

export interface CliDeps {
  env: Record<string, string | undefined>;
  log: Logger;
  exit(code: number): void;
  onSignal(signal: "SIGINT" | "SIGTERM", handler: () => Promise<void>): void;
  serviceContext?: (dryRun: boolean) => ServiceContext;
}

/** CLI entry: starts the daemon and wires SIGINT/SIGTERM to a clean stop. */
export async function runCli(argv: readonly string[], deps: CliDeps): Promise<Daemon | null> {
  try {
    const args = parseArgs(argv);
    if (args.command === "service") {
      await runService(args, deps);
      deps.exit(0);
      return null;
    }
    const daemon = await startDaemon(args, deps.env, deps.log);
    const stop = async () => {
      await daemon.stop();
      deps.exit(0);
    };
    deps.onSignal("SIGINT", stop);
    deps.onSignal("SIGTERM", stop);
    return daemon;
  } catch (error) {
    deps.log.error(`flightdeckd: ${error instanceof Error ? error.message : String(error)}`);
    deps.exit(error instanceof AlreadyRunningError ? EXIT_ALREADY_RUNNING : 1);
    return null;
  }
}
