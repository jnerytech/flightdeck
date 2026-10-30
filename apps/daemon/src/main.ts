import { createHash } from "node:crypto";
import { existsSync, unwatchFile, watchFile } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { formatPairingLink, PROTOCOL_VERSION } from "@flightdeck/protocol";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Actions } from "./actions/actions.ts";
import { runActionCli, runSnippetCli } from "./actions/cli.ts";
import { AgentConfig } from "./agentcfg/files.ts";
import { McpConfig } from "./agentcfg/mcp.ts";
import { Automations } from "./automations/automations.ts";
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
import { ProjectKeys } from "./central/project-key.ts";
import { runClaude } from "./central/wrapper.ts";
import { Forker } from "./checkpoints/fork.ts";
import { Rewinder } from "./checkpoints/rewind.ts";
import { Snapshots } from "./checkpoints/snapshots.ts";
import { claudeVersionProbe } from "./claude-probe.ts";
import {
  type Config,
  defaultConfigPath,
  expandHome,
  generateToken,
  loadConfig,
  RuntimeKind,
  updateConfigFile,
  userHome,
} from "./config.ts";
import { Budgets } from "./costs/budgets.ts";
import { Costs } from "./costs/costs.ts";
import { resolvePricing } from "./costs/pricing.ts";
import { runStatusline } from "./costs/statusline.ts";
import { UsageIndexer } from "./costs/usage-indexer.ts";
import { type Exec, spawnExec } from "./exec.ts";
import { HistoryIndexer } from "./history/indexer.ts";
import { Issues } from "./issues/issues.ts";
import { acquireLock, readLockPid } from "./lock.ts";
import { restoreBackup } from "./maintenance/backup.ts";
import { Maintenance } from "./maintenance/maintenance.ts";
import { daemonUrl, identityOf, startMcp } from "./mcp.ts";
import { runMessageCli } from "./messaging/cli.ts";
import { LocalEndpoints } from "./messaging/endpoints.ts";
import { Idle } from "./messaging/idle.ts";
import { Messaging } from "./messaging/messages.ts";
import { Names } from "./names/names.ts";
import { trackNames } from "./names/track.ts";
import { pairingAddress, renderQr, rotateToken, tailscaleIp } from "./pairing.ts";
import { AutoApprover, historyExcludes } from "./permissions/auto-approve.ts";
import { RiskClassifier } from "./permissions/risk.ts";
import { OpenSessionPersonas } from "./personas/open-session.ts";
import { packPersonas } from "./personas/pack.ts";
import { agentPublisher } from "./personas/publish.ts";
import { Personas } from "./personas/store.ts";
import { QuotaHistory } from "./quota/history.ts";
import { Quota } from "./quota/quota.ts";
import { UsageLedger } from "./quota/usage.ts";
import { Changes } from "./review/changes.ts";
import { ReviewComments } from "./review/comments.ts";
import { ReviewFiles } from "./review/files.ts";
import { SessionFiles } from "./review/session-files.ts";
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
import { defaultHistorySources, HistoryImporter } from "./snippets/history.ts";
import { SecretScanner } from "./snippets/model.ts";
import { Snippets } from "./snippets/store.ts";
import { SnippetUse } from "./snippets/use.ts";
import { AskpassBroker, askpassHook, runAskpass } from "./ssh/askpass.ts";
import { processExec, processRun, resolveSshPath, SshConnector } from "./ssh/connect.ts";
import { HostKeys } from "./ssh/hostkey.ts";
import { SshImporter } from "./ssh/import.ts";
import { chooseDelivery, processOps } from "./ssh/key-delivery.ts";
import { SshTargets } from "./ssh/targets.ts";
import { EventStore } from "./store/event-store.ts";
import { Teams } from "./teams/teams.ts";
import { terminalEnabled } from "./terminal/policy.ts";
import { bunPty, type PtyFactory } from "./terminal/pty.ts";
import { TerminalManager } from "./terminal/terminal-manager.ts";
import {
  requestShutdown,
  runUpdate,
  type StopDeps,
  stableBinPath,
  stopServiceDaemon,
  waitHealthy,
} from "./update.ts";
import { DaemonUpdater } from "./updates/apply.ts";
import { UpdateChecker } from "./updates/check.ts";
import { VaultRules } from "./vault/rules-store.ts";
import { Vault } from "./vault/vault.ts";
import { whichOnPath } from "./which.ts";
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
    | "askpass"
    | "mcp"
    | "statusline"
    | "action"
    | "snippet"
    | "message"
    | "version"
    | "db"
    | "backup"
    | "restore"
    | "update";
  /** `service <action>`, `hooks <action>`, `history reindex` or `action list|run`. */
  action?: ServiceAction | "reindex" | "list" | "run" | "get" | "send" | "idle" | "read" | "team";
  /** `message send <to> <text>`. */
  to?: string;
  text?: string;
  /** `message idle|read <session>`, with `--last N` for read. */
  session?: string;
  last?: number;
  /** `message team <team>`. */
  team?: string;
  /** `action ... --project <id>`. */
  project?: string;
  /** `action run <name>`. */
  actionName?: string;
  /** `snippet get <name>` (phase 18). */
  snippetName?: string;
  /** `snippet ... --project-path <path>`: the project whose snippets count too. */
  projectPath?: string;
  /** `snippet list --query <text>`. */
  query?: string;
  /** `action run ... --param k=v`, repeatable. */
  params?: Record<string, string>;
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
  /** `askpass <prompt...>`: what ssh is asking for. */
  askpassPrompt?: string;
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
  "     flightdeckd askpass <prompt>   (chamado pelo ssh via SSH_ASKPASS; config em FLIGHTDECK_CONFIG)",
  "     flightdeckd mcp [--config <arquivo>]   (servidor MCP stdio para o Claude Code deste host)",
  "     flightdeckd statusline [--config <arquivo>]   (uma linha para a statusline do Claude Code)",
  "     flightdeckd message list|send <para> <texto>|idle <sessão>|read <sessão> [--last N]|team <time>",
  "     flightdeckd action list [--project <id>] [--config <arquivo>]",
  "     flightdeckd action run <nome> [--project <id>] [--param chave=valor ...] [--config <arquivo>]",
  "     flightdeckd snippet list [--project-path <pasta>] [--query <texto>] [--config <arquivo>]",
  "     flightdeckd snippet get <nome> [--project-path <pasta>] [--config <arquivo>]",
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
      case "statusline":
        args.command = flag;
        break;
      case "claude":
        args.command = "claude";
        args.claudeArgs = argv.slice(i + 1);
        i = argv.length;
        break;
      case "askpass":
        args.command = "askpass";
        args.askpassPrompt = argv.slice(i + 1).join(" ");
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
      case "action": {
        args.command = "action";
        const action = argv[++i];
        if (action !== "list" && action !== "run") {
          throw new Error(`ação inválida: ${action ?? "(nenhuma)"}\n${USAGE}`);
        }
        args.action = action;
        if (action === "run") {
          const name = argv[++i];
          if (name === undefined || name.startsWith("--")) {
            throw new Error(`falta o nome da ação\n${USAGE}`);
          }
          args.actionName = name;
        }
        break;
      }
      case "snippet": {
        args.command = "snippet";
        const action = argv[++i];
        if (action !== "list" && action !== "get") {
          throw new Error(`ação de snippet inválida: ${action ?? "(nenhuma)"}\n${USAGE}`);
        }
        args.action = action;
        if (action === "get") {
          const name = argv[++i];
          if (name === undefined || name.startsWith("--")) {
            throw new Error(`falta o nome do snippet\n${USAGE}`);
          }
          args.snippetName = name;
        }
        break;
      }
      case "message": {
        args.command = "message";
        const action = argv[++i];
        if (
          action !== "list" &&
          action !== "send" &&
          action !== "idle" &&
          action !== "read" &&
          action !== "team"
        ) {
          throw new Error(`ação de mensagem inválida: ${action ?? "(nenhuma)"}\n${USAGE}`);
        }
        args.action = action;
        const operand = (what: string) => {
          const next = argv[++i];
          if (next === undefined || next.startsWith("--")) {
            throw new Error(`falta ${what}\n${USAGE}`);
          }
          return next;
        };
        if (action === "send") {
          args.to = operand("o endereço da sessão");
          args.text = operand("o texto");
        }
        if (action === "idle" || action === "read") args.session = operand("a sessão");
        if (action === "team") args.team = operand("o time");
        break;
      }
      case "--last": {
        const last = Number(value());
        if (!Number.isInteger(last) || last < 1)
          throw new Error(`--last quer um inteiro positivo\n${USAGE}`);
        args.last = last;
        break;
      }
      case "--project":
        args.project = value();
        break;
      case "--project-path":
        args.projectPath = value();
        break;
      case "--query":
        args.query = value();
        break;
      case "--param": {
        const [key, ...rest] = value().split("=");
        if (!key || rest.length === 0) throw new Error(`--param quer chave=valor\n${USAGE}`);
        args.params = { ...args.params, [key]: rest.join("=") };
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

/** What "Abrir no terminal" needs (phase 8): the stable binary when installed, the WSL distro. */
function terminalInfo(env: Record<string, string | undefined>) {
  const stable = stableBinPath(userHome(env), process.platform);
  return {
    flightdeckdPath: existsSync(stable) ? stable : null,
    wslDistro: env.WSL_DISTRO_NAME || null,
  };
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
    /** The PTY terminals run in; Bun's own when absent (tests inject a fake). */
    pty?: PtyFactory;
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
  const quotaHistory = new QuotaHistory({ db: store.db });
  const keys = new ProjectKeys(config.hostName);
  const usage = new UsageLedger({ db: store.db, projectKey: (cwd) => keys.keyFor(cwd) });
  // Phase 12: a git snapshot at the start and end of every turn, in the background.
  const snapshots = new Snapshots({ db: store.db });
  // Phase 13: one classifier for managed and terminal sessions, with the config's extra rules.
  const risk = new RiskClassifier({
    allowedRoots: config.allowedRoots,
    home: userHome(env),
    extraHigh: config.risk.extraHigh,
  });
  // Phase 13: the projects' automatic approval, through the board (defined below) and the costs.
  const autoApprove = new AutoApprover({
    db: store.db,
    runtime,
    dataDir: config.dataDir,
    context: (cwd) => {
      const found = board.projectForCwd(cwd);
      if (!found) return null;
      const { project, card } = found;
      return {
        projectId: project.id,
        settings: project.autoApprove,
        ...(card ? { description: card.description, cardId: card.id } : {}),
      };
    },
    usage: { record: (entry) => usageIndex.record(entry) },
  });
  // The vault joins this scanner when it exists (phase 16).
  const snippetScanner = new SecretScanner();
  // Phase 12's agent editor also writes the personas published as project agents.
  const agentcfg = new AgentConfig();
  const personaStore = new Personas({
    db: store.db,
    allowedRoots: config.allowedRoots,
    scanner: snippetScanner,
    pack: packPersonas,
    publisher: agentPublisher(agentcfg),
  });
  const manager = new SessionManager({
    store,
    runtime,
    risk,
    autoApprove,
    allowedRoots: config.allowedRoots,
    defaultPermissionMode: config.defaultPermissionMode,
    allowApiKey: config.allowApiKey,
    baseEnv: env,
    onQuota: (readings) => {
      quota.record(readings);
      quotaHistory.sample(readings);
    },
    onTurn: (sessionId, cwd, turn) => usage.record(sessionId, cwd, turn),
    onTurnEdge: (edge) =>
      snapshots.enqueue({
        cwd: edge.cwd,
        claudeSessionId: edge.claudeSessionId,
        kind: edge.kind,
        ...(edge.prompt !== undefined ? { prompt: edge.prompt } : {}),
        ...(edge.turnUuid !== undefined ? { turnUuid: edge.turnUuid } : {}),
      }),
    personas: personaStore,
  });
  const rewinder = new Rewinder({ snapshots, sessions: manager });
  const history = new HistoryIndexer({
    db: store.db,
    roots: config.history.roots,
    excludeCwds: historyExcludes(config),
    log: (m) => logger.log(m),
    ...(config.history.scanIntervalMs ? { scanIntervalMs: config.history.scanIntervalMs } : {}),
  });
  history.start();
  // Usage of every session of the host, from the transcripts (phase 8): first the ones that
  // already exist, in the background, then whatever the history index sees changing.
  const costs = new Costs({
    db: store.db,
    pricing: resolvePricing(config.pricing),
    loadPricing: () => resolvePricing(loadConfig(configFile).pricing),
    initialLoad: () => usageIndex.status(),
  });
  const usageIndex = new UsageIndexer({
    db: store.db,
    roots: config.history.roots,
    excludeCwds: historyExcludes(config),
    projectKey: (cwd) => keys.keyFor(cwd),
    cost: (tokens) => costs.cost(tokens),
    log: (m) => logger.log(m),
    onPass: () => budgets.evaluate(),
  });
  const budgets = new Budgets({ db: store.db });
  budgets.start();
  history.onChange(() => usageIndex.request());
  usageIndex.start();
  const board = new Board({
    db: store.db,
    manager,
    quota,
    allowedRoots: config.allowedRoots,
    maxParallelRuns: config.maxParallelRuns,
    budgets,
    projectKeys: keys,
    cardCost: costs.card.bind(costs),
    // A worktree is removed once no snapshot runs git in it (a busy folder on Windows).
    idle: snapshots.idle.bind(snapshots),
    ...(config.board.prPollIntervalMs ? { prPollIntervalMs: config.board.prPollIntervalMs } : {}),
    // Changed from the app: kept in the config file, like the rest of the host settings.
    onSettingsChange: ({ maxParallelRuns }) =>
      updateConfigFile(configFile, (raw) => ({ ...raw, maxParallelRuns })),
  });
  // The diff of every session and card, for the review (phase 11).
  const changes = new Changes({ db: store.db, board, log: logger.log.bind(logger) });
  const issues = new Issues({ board, autoApprove });
  // Phase 13: they listen to the board's PR polling for `ci_failed`, and run the schedule.
  const automations = new Automations({
    db: store.db,
    board,
    issues,
    autoApprove,
    pollMs: config.automations.issuePollIntervalMs,
    log: logger.log.bind(logger),
  });
  automations.start();
  // Retention at boot and every 24 h (backups join it in the same daily pass).
  const maintenance = new Maintenance({
    db: store.db,
    dataDir: config.dataDir,
    retention: config.retention,
    backup: config.backup,
    snapshots,
  });
  maintenance.start();
  // Checked in the background: a slow or unreachable release server never delays the boot.
  const updates = config.updates.manifestUrl
    ? new UpdateChecker({
        manifestUrl: config.updates.manifestUrl,
        checkIntervalH: config.updates.checkIntervalH,
        currentVersion: DAEMON_VERSION,
      })
    : undefined;
  void updates?.start();
  const updater = updates
    ? new DaemonUpdater({
        manifest: () => updates.latest(),
        dataDir: config.dataDir,
        ctx: osServiceContext(false),
      })
    : undefined;
  // Real shells behind a PTY, kept across connections; none outlives the daemon.
  const terminals = new TerminalManager({
    pty: options.pty ?? bunPty(),
    enabled: terminalEnabled(config.bind, config.terminal.enabled),
    allowedRoots: config.allowedRoots,
    max: config.terminal.max,
    idleMinutes: config.terminal.idleMinutes,
    allowApiKey: config.allowApiKey,
    // "Claude aqui" runs this very daemon's `claude`, with this config.
    claude: { self: daemonCommand(process.execPath, Bun.main), configFile },
    log: (message) => logger.log(message),
  });
  const central = new Central({
    risk,
    autoApprove,
    snapshots,
    db: store.db,
    manager,
    hooks: config.hooks,
    dataDir: config.dataDir,
    hostName: config.hostName,
    configFile,
    selfCommand: daemonCommand(process.execPath, Bun.main),
    settingsPath: claudeSettingsPath,
  });
  const sshTargets = new SshTargets({ db: store.db });
  const sshHostKeys = new HostKeys({ targets: sshTargets });
  const sshDir = join(config.dataDir, "ssh");
  const snippets = new Snippets({
    db: store.db,
    allowedRoots: config.allowedRoots,
    scanner: snippetScanner,
  });
  const askpass = new AskpassBroker({});
  const sshAskpass = askpassHook({
    broker: askpass,
    dir: sshDir,
    platform: process.platform,
    self: daemonCommand(process.execPath, Bun.main),
    configFile,
  });
  const sshConnect = new SshConnector({
    targets: sshTargets,
    hostKeys: sshHostKeys,
    terminals,
    dir: sshDir,
    sshPath:
      config.ssh.path ??
      resolveSshPath({ platform: process.platform, exists: existsSync, which: whichOnPath }),
    run: processRun(),
    exec: processExec(),
    ...(sshAskpass ? { askpass: sshAskpass } : {}),
    // The Windows agent runs only as a service with a fixed pipe: there the key is a temp file.
    delivery: chooseDelivery({
      platform: process.platform,
      keysDir: join(sshDir, "keys"),
      sockDir: tmpdir(),
      user: userInfo().username,
      exec: spawnExec,
      ops: processOps(),
    }),
  });

  // Phase 16: secrets the app hands over for one use; in memory only, gone with the daemon.
  const vault = new Vault({
    log: logger.log.bind(logger),
    actions: vaultActions(runtimeKind),
  });
  // Phase 17: the actions that use a secret from the vault without Claude seeing it.
  const actions = new Actions({
    db: store.db,
    vault,
    projects: (id) => board.getProject(id),
    // `ssh:` actions run on the phase 15 destinos; a vault-key destino's key is asked of the app.
    ssh: (job) => sshConnect.exec(job),
    sshTags: (name) => {
      const named = sshTargets.list().filter((t) => t.name === name);
      return named.length === 1 ? (named[0]?.tags ?? []) : [];
    },
    sshKey: (name) => {
      const named = sshTargets.list().filter((t) => t.name === name);
      return named.length === 1 && named[0]?.auth === "vault-key" ? named[0].secretRef : null;
    },
    // Phase 19: who may use which secret, decided by the rules the app hands over.
    rules: new VaultRules(),
    hostName: config.hostName,
    risk: (command, cwd) => risk.classify("Bash", { command }, cwd).level,
    projectKey: (id) => keys.keyFor(board.getProject(id).path),
  });
  // Phase 21: messages between sessions, delivered here and carried between hosts by the app.
  const endpoints = new LocalEndpoints({
    manager,
    external: central.external,
    nameOf: (claudeSessionId) => central.meta.get(claudeSessionId).name,
    projectKey: (cwd) => keys.keyFor(cwd),
    cardOf: (sessionId) => board.projectForCwd(manager.get(sessionId).cwd)?.card?.id ?? null,
    sendToLaunch: central.sendToLaunch.bind(central),
    autoApprove,
  });
  // Phase 21: every session of this host has a standard name and an alias that addresses it.
  const names = new Names(store.db);
  // The messaging service asks the teams who is on one, and the teams need the messaging service.
  let teams: Teams | undefined;
  const messaging = new Messaging({
    db: store.db,
    host: config.hostName,
    endpoints,
    names,
    teamOf: (sessionId) => teams?.teamOf(sessionId) ?? null,
  });
  teams = new Teams({
    db: store.db,
    board,
    manager,
    messaging,
    host: config.hostName,
    quota,
    names,
  });
  // Of a managed session only: the id of a terminal session is not one the manager knows.
  const cardOf = (sessionId: string) => {
    const cwd = manager.list().find((s) => s.id === sessionId)?.cwd;
    return cwd ? (board.projectForCwd(cwd)?.card?.id ?? null) : null;
  };
  const stopNames = trackNames({
    names,
    manager,
    external: central.external,
    projectOf: (cwd) => keys.keyFor(board.projectForCwd(cwd)?.project.path ?? cwd),
    cardOf,
    personaOf: (sessionId) => {
      const card = cardOf(sessionId);
      return card ? (teams?.personaOfCard(card) ?? null) : null;
    },
  });
  const idle = new Idle({ endpoints, messaging, host: config.hostName });
  const messagingSweep = setInterval(messaging.sweep.bind(messaging), 5 * 60_000);
  const server = startServer({
    manager,
    messaging,
    names,
    idle,
    teams,
    vault,
    log: logger.log.bind(logger),
    actions,
    autoApprove,
    issues,
    automations,
    history,
    board,
    quota,
    usage,
    costs,
    budgets,
    quotaHistory,
    changes,
    review: new ReviewComments({ db: store.db, changes, manager, board, central }),
    sessionFiles: new SessionFiles({ db: store.db }),
    ssh: sshTargets,
    // Read-only: this host's own ~/.ssh/config, under whatever home the daemon runs with.
    sshHostKeys,
    sshConnect,
    askpass,
    snippets,
    personas: personaStore,
    personaSessions: new OpenSessionPersonas({ personas: personaStore, manager, central }),
    snippetUse: new SnippetUse({
      snippets,
      terminals,
      manager,
      central,
      exec: spawnExec,
      allowedRoots: config.allowedRoots,
    }),
    snippetHistory: new HistoryImporter({
      sources: defaultHistorySources({
        home: homedir(),
        appData: process.env.APPDATA,
        platform: process.platform,
      }),
      scanner: snippetScanner,
      snippets,
    }),
    sshImport: new SshImporter({
      targets: sshTargets,
      configPath: join(homedir(), ".ssh", "config"),
      home: homedir(),
      defaultUser: userInfo().username,
    }),
    terminals,
    // Turned on or off from the app: kept in the config file, like the rest of the host settings.
    onTerminalSettings: (enabled) =>
      updateConfigFile(configFile, (raw) => ({
        ...raw,
        terminal: { ...(raw.terminal as object | undefined), enabled },
      })),
    files: new ReviewFiles({
      changes,
      dataDir: config.dataDir,
      allowedRoots: config.allowedRoots,
    }),
    central,
    maintenance,
    ...(updates ? { updates } : {}),
    snapshots,
    rewinder,
    forker: new Forker({ runtime, manager, rewinder }),
    mcp: new McpConfig(),
    agentcfg,
    ...(updater ? { updater } : {}),
    hostName: config.hostName,
    bind: config.bind,
    port: config.port,
    token: config.token,
    allowedRoots: config.allowedRoots,
    allowedNetworks: config.allowedNetworks,
    ...(claude ? { claude } : {}),
    ...(options.onShutdown ? { onShutdown: options.onShutdown } : {}),
    terminal: terminalInfo(env),
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
        automations.stop();
        clearInterval(messagingSweep);
        stopNames();
        teams.stop();
        idle.stop();
        messaging.stop();
        endpoints.stop();
        actions.stop();
        vault.stop();
        await automations.idle();
        board.stop();
        terminals.stop();
        await central.stop();
        maintenance.stop();
        updates?.stop();
        await manager.shutdown();
        await server.stop();
        history.stop();
        await usageIndex.stop();
        budgets.stop();
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
      excludeCwds: historyExcludes(config),
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
/**
 * What a delivered secret can be used for. In this phase only the fake runtime has an action, the
 * smoke's `echo`, which answers the value's SHA-256 and never the value: no real daemon has a way
 * to read a secret back out.
 */
export function vaultActions(kind: RuntimeKind): Record<string, (value: string) => string> {
  return kind === "fake"
    ? { echo: (value) => createHash("sha256").update(value).digest("hex") }
    : {};
}

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
  /** The folder `flightdeckd mcp` runs in; the process's when absent. */
  cwd?: string;
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
        cwd: deps.cwd ?? process.cwd(),
        config: loadConfig(file),
        env: deps.env,
        self: deps.selfCommand ?? daemonCommand(process.execPath, Bun.main),
        log: deps.log,
        timeoutMs: deps.hookConnectTimeoutMs ?? HOOK_CONNECT_TIMEOUT_MS,
      });
      deps.exit(code);
      return null;
    }
    if (args.command === "askpass") {
      // ssh runs this with only the prompt, so the config comes from the environment.
      const file = resolve(expandHome(deps.env.FLIGHTDECK_CONFIG ?? defaultConfigPath()));
      const secret = await runAskpass({
        configFile: file,
        ticket: deps.env.FLIGHTDECK_ASKPASS_TICKET,
        prompt: args.askpassPrompt ?? "",
      });
      deps.log.log(secret);
      deps.exit(0);
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
    if (args.command === "statusline") {
      // Never creates the config: a statusline runs where there may be no daemon at all.
      const line = await runStatusline({
        configFile: configPath(args),
        stdin: deps.stdin ?? Bun.stdin.stream(),
      });
      deps.log.log(line);
      deps.exit(0);
      return null;
    }
    if (args.command === "mcp") {
      const config = loadConfig(configPath(args));
      const mcp = await startMcp({
        url: daemonUrl(config),
        token: config.token,
        transport: deps.mcpTransport ?? new StdioServerTransport(),
        cwd: deps.cwd ?? process.cwd(),
        identity: identityOf(deps.env),
      });
      void mcp.closed.then(() => deps.exit(0));
      return null;
    }
    if (args.command === "message") {
      const config = loadConfig(configPath(args));
      const printed = await runMessageCli(
        {
          action: args.action as "list" | "send" | "idle" | "read" | "team",
          to: args.to,
          text: args.text,
          session: args.session,
          last: args.last,
          team: args.team,
        },
        config,
        identityOf(deps.env),
      );
      deps.log.log(JSON.stringify(printed, null, 2));
      deps.exit(0);
      return null;
    }
    if (args.command === "action") {
      const config = loadConfig(configPath(args));
      const printed = await runActionCli(
        {
          action: args.action as "list" | "run",
          project: args.project,
          name: args.actionName,
          params: args.params,
        },
        config,
      );
      deps.log.log(JSON.stringify(printed, null, 2));
      deps.exit(0);
      return null;
    }
    if (args.command === "snippet") {
      const config = loadConfig(configPath(args));
      const printed = await runSnippetCli(
        {
          action: args.action as "list" | "get",
          name: args.snippetName,
          projectPath: args.projectPath,
          query: args.query,
        },
        config,
      );
      deps.log.log(JSON.stringify(printed, null, 2));
      deps.exit(0);
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
