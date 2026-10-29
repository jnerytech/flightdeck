import { unwatchFile, watchFile } from "node:fs";
import { join, resolve } from "node:path";
import { formatPairingLink, PROTOCOL_VERSION } from "@flightdeck/protocol";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Board } from "./board/board.ts";
import { Central } from "./central/central.ts";
import { startChannel } from "./central/channel.ts";
import { sendSessionStart } from "./central/hook-command.ts";
import {
  type HooksStatus,
  type HookTarget,
  hooksStatus,
  installHooks,
  uninstallHooks,
} from "./central/hooks-install.ts";
import { runClaude } from "./central/wrapper.ts";
import { claudeVersionProbe } from "./claude-probe.ts";
import {
  type Config,
  defaultConfigPath,
  expandHome,
  generateToken,
  loadConfig,
  RuntimeKind,
  updateConfigFile,
} from "./config.ts";
import { type Exec, spawnExec } from "./exec.ts";
import { HistoryIndexer } from "./history/indexer.ts";
import { acquireLock, readLockPid } from "./lock.ts";
import { restoreBackup } from "./maintenance/backup.ts";
import { Maintenance } from "./maintenance/maintenance.ts";
import { daemonUrl, startMcp } from "./mcp.ts";
import { pairingAddress, renderQr, rotateToken, tailscaleIp } from "./pairing.ts";
import { Quota } from "./quota/quota.ts";
import { FakeRuntime } from "./runtime/fake-runtime.ts";
import type { AgentRuntime } from "./runtime/types.ts";
import { DAEMON_VERSION, startServer } from "./server.ts";
import {
  daemonCommand,
  installService,
  resolveServiceClaude,
  type ServiceCommand,
  type ServiceContext,
  serviceCommand,
  serviceStatus,
  startService,
  uninstallService,
} from "./service.ts";
import { killProcess, osServiceContext, processPath } from "./service-os.ts";
import { SessionManager } from "./sessions/session-manager.ts";
import { EventStore } from "./store/event-store.ts";
import {
  requestShutdown,
  runUpdate,
  type StopDeps,
  stableBinPath,
  stopServiceDaemon,
  waitHealthy,
} from "./update.ts";
import { type WslItem, WslSupervisor } from "./wsl.ts";

export type ServiceAction = "install" | "uninstall" | "status" | "stop" | "start";

export interface CliArgs {
  command:
    | "start"
    | "pair"
    | "service"
    | "history"
    | "hooks"
    | "hook"
    | "channel"
    | "claude"
    | "mcp"
    | "version"
    | "db"
    | "backup"
    | "restore"
    | "update";
  /** `service <action>`, `hooks <action>` or `history reindex`. */
  action?: ServiceAction | "reindex";
  /** `service ... --dry-run`: print, change nothing. */
  dryRun?: true;
  config?: string;
  runtime?: RuntimeKind;
  /** `pair --rotate`: generate a new token first. */
  rotate?: true;
  /** `hook session-start --url <receptor> --token <hooks.token>`, as `hooks install` writes it. */
  url?: string;
  token?: string;
  /** `channel --launch <id>`: the `flightdeckd claude` launch this channel serves. */
  launch?: string;
  /** `backup --out <file>`. */
  out?: string;
  /** `restore <file>`. */
  file?: string;
  /** `update --from <binary> [--allow-downgrade]`. */
  from?: string;
  allowDowngrade?: true;
  /** `claude [args]`: everything after `claude` belongs to the real claude. */
  claudeArgs?: string[];
}

const USAGE = [
  "uso: flightdeckd [start] [--config <arquivo>] [--runtime fake|claude]",
  "     flightdeckd --version",
  "     flightdeckd db prune [--dry-run] [--config <arquivo>]",
  "     flightdeckd backup [--out <arquivo>] [--config <arquivo>]",
  "     flightdeckd restore <arquivo> [--config <arquivo>]   (com o daemon parado)",
  "     flightdeckd update --from <binário> [--allow-downgrade] [--config <arquivo>]",
  "     flightdeckd pair [--rotate] [--config <arquivo>]",
  "     flightdeckd service install|uninstall|status|stop|start [--dry-run] [--config <arquivo>]",
  "     flightdeckd history reindex [--config <arquivo>]",
  "     flightdeckd hooks install|uninstall|status [--config <arquivo>]",
  "     flightdeckd hook session-start --url <receptor> --token <token>   (chamado pelo Claude Code)",
  "     flightdeckd channel --launch <id> --url <receptor> --token <token>   (servidor MCP do canal)",
  "     flightdeckd claude [argumentos do claude]   (config em FLIGHTDECK_CONFIG)",
  "     flightdeckd mcp [--config <arquivo>]   (servidor MCP stdio para o Claude Code deste host)",
].join("\n");

const SERVICE_ACTIONS: readonly ServiceAction[] = [
  "install",
  "uninstall",
  "status",
  "stop",
  "start",
];

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
      case "db": {
        args.command = "db";
        const action = argv[++i];
        if (action !== "prune")
          throw new Error(`ação de db inválida: ${action ?? "(nenhuma)"}\n${USAGE}`);
        break;
      }
      case "backup":
        args.command = "backup";
        break;
      case "--out":
        args.out = value();
        break;
      case "restore": {
        args.command = "restore";
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) args.file = argv[++i];
        break;
      }
      case "update":
        args.command = "update";
        break;
      case "--from":
        args.from = value();
        break;
      case "--allow-downgrade":
        args.allowDowngrade = true;
        break;
      case "--version":
        args.command = "version";
        break;
      case "start":
      case "pair":
        args.command = flag;
        break;
      case "--rotate":
        args.rotate = true;
        break;
      case "service": {
        args.command = "service";
        const action = argv[++i] as ServiceAction | undefined;
        if (!action || !SERVICE_ACTIONS.includes(action)) {
          throw new Error(`ação de serviço inválida: ${action ?? "(nenhuma)"}\n${USAGE}`);
        }
        args.action = action;
        break;
      }
      case "hook": {
        args.command = "hook";
        const event = argv[++i];
        if (event !== "session-start") throw new Error(`hook inválido: ${event ?? "(nenhum)"}`);
        break;
      }
      case "channel":
      case "mcp":
        args.command = flag;
        break;
      case "claude":
        args.command = "claude";
        args.claudeArgs = argv.slice(i + 1);
        i = argv.length;
        break;
      case "--launch":
        args.launch = value();
        break;
      case "--url":
        args.url = value();
        break;
      case "--token":
        args.token = value();
        break;
      case "hooks": {
        args.command = "hooks";
        const action = argv[++i];
        if (action !== "install" && action !== "uninstall" && action !== "status") {
          throw new Error(`ação de hooks inválida: ${action ?? "(nenhuma)"}\n${USAGE}`);
        }
        args.action = action;
        break;
      }
      case "history": {
        args.command = "history";
        const action = argv[++i];
        if (action !== "reindex") {
          throw new Error(`ação de histórico inválida: ${action ?? "(nenhuma)"}\n${USAGE}`);
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

/** `hook session-start` gives up on the receptor after this long (the hook's own limit is 5 s). */
export const HOOK_CONNECT_TIMEOUT_MS = 1_000;

/** Exit code when another daemon already owns the same `dataDir`. */
export const EXIT_ALREADY_RUNNING = 3;

export class AlreadyRunningError extends Error {
  constructor(dataDir: string, hint?: string) {
    super(`já em execução (dataDir ${dataDir})${hint ? `; ${hint}` : ""}`);
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
  options: {
    configWatchMs?: number;
    wslCommand?: (item: WslItem) => string[];
    /** What `daemon.shutdown` triggers; the command is refused without it. */
    onShutdown?: () => void;
  } = {},
): Promise<Daemon> {
  const configFile = configPath(args);
  const config = loadConfig(configFile);
  const runtimeKind = args.runtime ?? config.runtime;
  // Before SQLite and the port: a second daemon must not touch either.
  const lock = acquireLock(config.dataDir);
  if (!lock) throw new AlreadyRunningError(config.dataDir);
  const store = new EventStore(join(config.dataDir, "flightdeck.db"));
  const claudePath = config.claude?.executablePath ?? config.claudePath;
  const { runtime, claude } = await createRuntime(runtimeKind, claudePath);
  // The plan quota is the host's: every managed session feeds it (phase 7).
  const quota = new Quota({ pauseAt: config.quota.pauseAt });
  const manager = new SessionManager({
    store,
    runtime,
    allowedRoots: config.allowedRoots,
    defaultPermissionMode: config.defaultPermissionMode,
    allowApiKey: config.allowApiKey,
    baseEnv: env,
    onQuota: (readings) => quota.record(readings),
  });
  const history = new HistoryIndexer({
    db: store.db,
    roots: config.history.roots,
    excludeCwds: config.history.excludeCwds,
    log: (m) => logger.log(m),
    ...(config.history.scanIntervalMs ? { scanIntervalMs: config.history.scanIntervalMs } : {}),
  });
  history.start();
  const board = new Board({
    db: store.db,
    manager,
    allowedRoots: config.allowedRoots,
    maxParallelRuns: config.maxParallelRuns,
    ...(config.board.prPollIntervalMs ? { prPollIntervalMs: config.board.prPollIntervalMs } : {}),
    // Changed from the app: kept in the config file, like the rest of the host settings.
    onSettingsChange: ({ maxParallelRuns }) =>
      updateConfigFile(configFile, (raw) => ({ ...raw, maxParallelRuns })),
  });
  // Retention at boot and every 24 h (backups join it in the same daily pass).
  const maintenance = new Maintenance({
    db: store.db,
    dataDir: config.dataDir,
    retention: config.retention,
    backup: config.backup,
  });
  maintenance.start();
  const central = new Central({
    db: store.db,
    manager,
    hooks: config.hooks,
    dataDir: config.dataDir,
    hostName: config.hostName,
    configFile,
    selfCommand: daemonCommand(process.execPath, Bun.main),
    settingsPath: claudeSettingsPath,
  });
  const server = startServer({
    manager,
    history,
    board,
    quota,
    central,
    maintenance,
    hostName: config.hostName,
    bind: config.bind,
    port: config.port,
    token: config.token,
    allowedRoots: config.allowedRoots,
    allowedNetworks: config.allowedNetworks,
    ...(claude ? { claude } : {}),
    ...(options.onShutdown ? { onShutdown: options.onShutdown } : {}),
  });

  const wsl =
    config.wsl.length > 0
      ? new WslSupervisor(config.wsl, {
          logDir: join(config.dataDir, "logs"),
          ...(options.wslCommand ? { command: options.wslCommand } : {}),
        })
      : null;
  wsl?.start();

  // `pair --rotate` runs in another process: follow the token in the config file.
  const onConfigChange = () => {
    const token = readToken(configFile);
    if (token) server.setToken(token);
  };
  watchFile(configFile, { interval: options.configWatchMs ?? 2000 }, onConfigChange);

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
        unwatchFile(configFile, onConfigChange);
        await wsl?.stop();
        board.stop();
        await central.stop();
        maintenance.stop();
        await manager.shutdown();
        await server.stop();
        history.stop();
        quota.stop();
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

/** Current token in the config file, or `null` while it is unreadable or invalid. */
function readToken(file: string): string | null {
  try {
    return loadConfig(file).token;
  } catch {
    return null;
  }
}

/** `flightdeckd pair`: prints the pairing link and its QR code. */
async function runPair(args: CliArgs, deps: CliDeps): Promise<void> {
  const file = configPath(args);
  if (args.rotate) rotateToken(file);
  const config = loadConfig(file);
  const address = pairingAddress(config.bind, await tailscaleIp(deps.exec ?? spawnExec));
  const link = formatPairingLink({
    address,
    port: config.port,
    name: config.hostName,
    token: config.token,
  });
  deps.log.log(link);
  deps.log.log(await renderQr(link));
}

/**
 * `flightdeckd service install|uninstall|status`. With `--dry-run` nothing is written, not even
 * the config, so `loadConfig` (which creates a missing file) is never called in that mode.
 */
/** The config of the installed service: `--config` on the CLI, else the service's own one. */
const serviceConfig = (args: CliArgs, installed: ServiceCommand) =>
  loadConfig(args.config ? configPath(args) : (installed.config ?? configPath(args)));

/** Where a daemon of `config` answers `GET /health`. */
const healthUrl = (config: Config) =>
  new URL("/health", daemonUrl(config).replace(/^ws:/, "http:")).href;

/**
 * Stops the daemon of the installed service (`daemon.shutdown`, the task or unit, the lock).
 * Null without a service; false when the daemon is still there.
 */
async function stopInstalledDaemon(
  args: CliArgs,
  ctx: ServiceContext,
  deps: CliDeps,
): Promise<boolean | null> {
  const installed = await serviceCommand(ctx);
  if (!installed) return null;
  const stop = {
    ...serviceStopDeps(ctx, deps.log),
    ...(deps.serviceStopTimeoutMs ? { stopTimeoutMs: deps.serviceStopTimeoutMs } : {}),
  };
  return stopServiceDaemon(stop, serviceConfig(args, installed), installed.command[0] as string);
}

/** `service stop`: the daemon goes, the task or unit stays installed. */
async function stopService(args: CliArgs, ctx: ServiceContext, deps: CliDeps): Promise<void> {
  const stopped = await stopInstalledDaemon(args, ctx, deps);
  if (stopped === null) throw new Error("nenhum serviço instalado");
  if (!stopped) throw new Error("o daemon do serviço não parou: pare-o à mão");
  deps.log.log("daemon do serviço parado (o serviço continua instalado)");
}

/** `service start`: runs the task or unit and waits for `/health` of the service's config. */
async function startInstalledService(
  args: CliArgs,
  ctx: ServiceContext,
  deps: CliDeps,
): Promise<void> {
  const installed = await serviceCommand(ctx);
  if (!installed) throw new Error("nenhum serviço instalado");
  const url = healthUrl(serviceConfig(args, installed));
  await startService(ctx);
  if (!(await waitHealthy(url, deps.serviceHealthTimeoutMs ?? 30_000, 250))) {
    throw new Error(`o daemon do serviço não respondeu em /health (${url})`);
  }
  deps.log.log(`daemon do serviço respondendo em ${url}`);
}

async function runService(args: CliArgs, deps: CliDeps): Promise<void> {
  const ctx = (deps.serviceContext ?? osServiceContext)(args.dryRun === true);
  if (args.action === "status") return printResult(deps, await serviceStatus(ctx));
  if (args.action === "stop") return stopService(args, ctx, deps);
  if (args.action === "start") return startInstalledService(args, ctx, deps);
  if (args.action === "uninstall") {
    // Removing the task or unit alone would leave the daemon running: it goes first.
    if (!ctx.dryRun && (await stopInstalledDaemon(args, ctx, deps)) === false) {
      deps.log.error("aviso: o daemon do serviço continua rodando; pare-o à mão");
    }
    return printResult(deps, await uninstallService(ctx));
  }
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
  // The service only gets --config when the user gave one, always as an absolute path.
  printResult(deps, await installService(ctx, args.config ? resolve(args.config) : null));
}

/**
 * `flightdeckd history reindex`: drops the transcript index and builds it again. Takes the
 * daemon's lock, so it refuses (exit 3) while a daemon uses the same `dataDir`.
 */
function runReindex(args: CliArgs, deps: CliDeps): void {
  const config = loadConfig(configPath(args));
  const lock = acquireLock(config.dataDir);
  if (!lock) {
    throw new AlreadyRunningError(config.dataDir, "pare o daemon antes de reconstruir o índice");
  }
  const store = new EventStore(join(config.dataDir, "flightdeck.db"));
  try {
    const history = new HistoryIndexer({
      db: store.db,
      roots: config.history.roots,
      excludeCwds: config.history.excludeCwds,
    });
    const { sessions, messages } = history.rebuild();
    deps.log.log(`histórico reconstruído: ${sessions} sessões, ${messages} mensagens`);
  } finally {
    store.close();
    lock.release();
  }
}

const HOOKS_LABELS: Record<HooksStatus, string> = {
  installed: "instalados",
  absent: "ausentes",
  outdated: "desatualizados (rode hooks install de novo)",
};

/** Where Claude Code reads the user's hooks; resolved at call time (tests swap HOME). */
export const claudeSettingsPath = () => expandHome("~/.claude/settings.json");

/** What `hooks install` writes for this config: this executable, the receptor and its token. */
export function hookTarget(
  config: Config,
  selfCommand: string[],
  port = config.hooks.port,
): HookTarget {
  return {
    command: selfCommand,
    url: `http://127.0.0.1:${port}`,
    token: config.hooks.token ?? "",
    permissionTimeoutS: config.hooks.permissionTimeoutS,
  };
}

/**
 * `flightdeckd hooks install|uninstall|status`: the only write of Flightdeck in ~/.claude, always
 * by an explicit command. Install generates `hooks.token` once and keeps it afterwards.
 */
function runHooks(args: CliArgs, deps: CliDeps): void {
  const file = configPath(args);
  let config = loadConfig(file);
  const settings = claudeSettingsPath();
  const self = deps.selfCommand ?? daemonCommand(process.execPath, Bun.main);
  if (args.action === "status") {
    deps.log.log(`hooks: ${HOOKS_LABELS[hooksStatus(settings, hookTarget(config, self))]}`);
    return;
  }
  if (args.action === "uninstall") {
    const removed = uninstallHooks(settings);
    deps.log.log(
      removed ? `hooks removidos de ${settings}` : "nenhum hook do Flightdeck instalado",
    );
    return;
  }
  if (config.hooks.port === 0) {
    throw new Error(
      "hooks.port 0 não serve para hooks instalados: defina uma porta fixa na config",
    );
  }
  if (!config.hooks.token) {
    const token = generateToken();
    updateConfigFile(file, (raw) => ({ ...raw, hooks: { ...(raw.hooks as object), token } }));
    config = loadConfig(file);
  }
  installHooks(settings, hookTarget(config, self));
  deps.log.log(
    `hooks instalados em ${settings} (cópia anterior em settings.json.flightdeck-backup)`,
  );
}

/** `flightdeckd backup [--out <file>]`: a backup now, with the daemon running or not. */
function runBackup(args: CliArgs, deps: CliDeps): void {
  const config = loadConfig(configPath(args));
  const store = new EventStore(join(config.dataDir, "flightdeck.db"));
  try {
    const info = new Maintenance({
      db: store.db,
      dataDir: config.dataDir,
      retention: config.retention,
      backup: config.backup,
      ...(deps.now ? { now: deps.now } : {}),
    }).backupNow(args.out);
    deps.log.log(`backup criado: ${info.path} (${info.bytes} bytes)`);
  } finally {
    store.close();
  }
}

/** `flightdeckd update --from <binary>`: the binary in the stable path, service and hooks on it. */
/** The real pieces that stop the daemon of a service: shutdown request, lock and process. */
function serviceStopDeps(ctx: ServiceContext, log: Logger): StopDeps {
  return {
    ctx,
    log,
    daemonRunning: (config) => {
      const lock = acquireLock(config.dataDir);
      lock?.release();
      return lock === null;
    },
    shutdown: (config) => requestShutdown(daemonUrl(config), config.token, 3_000),
    lockPid: readLockPid,
    processPath,
    kill: killProcess,
  };
}

async function runUpdateCommand(args: CliArgs, deps: CliDeps): Promise<number> {
  if (!args.from) throw new Error("update precisa de --from <binário novo>");
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

/** `flightdeckd restore <file>`: only with the daemon stopped. */
function runRestore(args: CliArgs, deps: CliDeps): void {
  if (!args.file) throw new Error("restore precisa do arquivo: flightdeckd restore <arquivo>");
  const config = loadConfig(configPath(args));
  const { beforeRestore } = restoreBackup({ file: args.file, dataDir: config.dataDir });
  deps.log.log(`banco restaurado de ${args.file}; o anterior ficou em ${beforeRestore}`);
}

/** `flightdeckd db prune [--dry-run]`: the retention policy now, with the count per table. */
function runPrune(args: CliArgs, deps: CliDeps): void {
  const config = loadConfig(configPath(args));
  const store = new EventStore(join(config.dataDir, "flightdeck.db"));
  try {
    const maintenance = new Maintenance({
      db: store.db,
      dataDir: config.dataDir,
      retention: config.retention,
      ...(deps.now ? { now: deps.now } : {}),
    });
    const counts = maintenance.prune(args.dryRun === true);
    deps.log.log(args.dryRun ? "simulação da limpeza (nada foi apagado):" : "limpeza feita:");
    for (const [table, n] of Object.entries(counts)) deps.log.log(`  ${table}: ${n}`);
  } finally {
    store.close();
  }
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
  /** Runs external commands (`tailscale ip -4`); injected in tests. */
  exec?: Exec;
  /** This daemon's own command line, as hooks call it back; derived from the process if absent. */
  selfCommand?: string[];
  /** Standard input (`hook session-start` reads the hook's JSON); the process's if absent. */
  stdin?: ReadableStream<Uint8Array>;
  /** How long `hook session-start` tries to reach the receptor. */
  hookConnectTimeoutMs?: number;
  /** How long `service uninstall` waits for the daemon to free its lock (10 s when absent). */
  serviceStopTimeoutMs?: number;
  /** How long `service start` waits for `/health` (30 s when absent). */
  serviceHealthTimeoutMs?: number;
  /** Clock of `db prune`, `backup` and `restore`; `Date.now` when absent. */
  now?: () => number;
  /** Where `flightdeckd channel` speaks MCP; stdio when absent. */
  channelTransport?: Transport;
  /** Where `flightdeckd mcp` speaks MCP; stdio when absent. */
  mcpTransport?: Transport;
}

/** CLI entry: starts the daemon and wires SIGINT/SIGTERM to a clean stop. */
export async function runCli(argv: readonly string[], deps: CliDeps): Promise<Daemon | null> {
  try {
    const args = parseArgs(argv);
    if (args.command === "backup") {
      runBackup(args, deps);
      deps.exit(0);
      return null;
    }
    if (args.command === "restore") {
      runRestore(args, deps);
      deps.exit(0);
      return null;
    }
    if (args.command === "update") {
      deps.exit(await runUpdateCommand(args, deps));
      return null;
    }
    if (args.command === "db") {
      runPrune(args, deps);
      deps.exit(0);
      return null;
    }
    if (args.command === "version") {
      deps.log.log(`flightdeckd ${DAEMON_VERSION} (protocolo ${PROTOCOL_VERSION})`);
      deps.exit(0);
      return null;
    }
    if (args.command === "hook") {
      await sendSessionStart({
        url: args.url ?? "",
        token: args.token ?? "",
        input: await new Response(deps.stdin ?? Bun.stdin.stream()).text(),
        env: deps.env,
        timeoutMs: deps.hookConnectTimeoutMs ?? HOOK_CONNECT_TIMEOUT_MS,
      });
      deps.exit(0);
      return null;
    }
    if (args.command === "claude") {
      // Its own arguments all go to claude, so the config comes from the environment.
      const file = resolve(expandHome(deps.env.FLIGHTDECK_CONFIG ?? defaultConfigPath()));
      const code = await runClaude({
        args: args.claudeArgs ?? [],
        config: loadConfig(file),
        env: deps.env,
        self: deps.selfCommand ?? daemonCommand(process.execPath, Bun.main),
        log: deps.log,
        timeoutMs: deps.hookConnectTimeoutMs ?? HOOK_CONNECT_TIMEOUT_MS,
      });
      deps.exit(code);
      return null;
    }
    if (args.command === "channel") {
      const channel = await startChannel({
        launchId: args.launch ?? "",
        url: args.url ?? "",
        token: args.token ?? "",
        transport: deps.channelTransport ?? new StdioServerTransport(),
      }).catch((error: Error) => {
        throw new Error(`não consegui abrir o canal do Flightdeck: ${error.message}`);
      });
      void channel.closed.then(() => deps.exit(0));
      return null;
    }
    if (args.command === "mcp") {
      const config = loadConfig(configPath(args));
      const mcp = await startMcp({
        url: daemonUrl(config),
        token: config.token,
        transport: deps.mcpTransport ?? new StdioServerTransport(),
      });
      void mcp.closed.then(() => deps.exit(0));
      return null;
    }
    if (args.command === "hooks") {
      runHooks(args, deps);
      deps.exit(0);
      return null;
    }
    if (args.command === "history") {
      runReindex(args, deps);
      deps.exit(0);
      return null;
    }
    if (args.command === "pair" || args.command === "service") {
      await (args.command === "pair" ? runPair(args, deps) : runService(args, deps));
      deps.exit(0);
      return null;
    }
    let stopping: Promise<void> | null = null;
    // SIGINT, SIGTERM and `daemon.shutdown` all close the same way, once.
    const stop = () => {
      stopping ??= daemon.stop().then(() => deps.exit(0));
      return stopping;
    };
    const daemon = await startDaemon(args, deps.env, deps.log, { onShutdown: () => void stop() });
    deps.onSignal("SIGINT", stop);
    deps.onSignal("SIGTERM", stop);
    return daemon;
  } catch (error) {
    deps.log.error(`flightdeckd: ${error instanceof Error ? error.message : String(error)}`);
    deps.exit(error instanceof AlreadyRunningError ? EXIT_ALREADY_RUNNING : 1);
    return null;
  }
}
