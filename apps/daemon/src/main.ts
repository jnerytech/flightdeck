import { createHash, randomUUID } from "node:crypto";
import { unwatchFile, watchFile } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import {
  formatPairingLink,
  PROTOCOL_VERSION,
  type ServiceInstallResult,
} from "@flightdeck/protocol";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Account } from "./account/account.ts";
import { demoAccountReaders } from "./account/demo.ts";
import { accountReaders } from "./account/readers.ts";
import { Actions } from "./actions/actions.ts";
import { runActionCli, runSnippetCli } from "./actions/cli.ts";
import { AgentConfig } from "./agentcfg/files.ts";
import { McpConfig } from "./agentcfg/mcp.ts";
import { assistantService } from "./assistant/factory.ts";
import { assistantDir } from "./assistant/paths.ts";
import { Automations } from "./automations/automations.ts";
import { BgService } from "./bg/service.ts";
import { Board } from "./board/board.ts";
import { templateRootOf } from "./board/spec-template.ts";
import { BoardSync } from "./boardsync/engine.ts";
import { GithubBoards } from "./boardsync/github.ts";
import { BoardSyncLoop } from "./boardsync/loop.ts";
import { BoardSyncService } from "./boardsync/service.ts";
import { BoardSyncStore } from "./boardsync/store.ts";
import { Central, messageExternal } from "./central/central.ts";
import { startChannel } from "./central/channel.ts";
import { sendSessionStart } from "./central/hook-command.ts";
import {
  type HooksStatus,
  type HookTarget,
  hooksStatus,
  installHooks,
  uninstallHooks,
} from "./central/hooks-install.ts";
import { type AsyncGitRunner, ProjectKeys } from "./central/project-key.ts";
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
  RELEASES_URL,
  RuntimeKind,
  updateConfigFile,
  userHome,
} from "./config.ts";
import { Budgets } from "./costs/budgets.ts";
import { Costs } from "./costs/costs.ts";
import { resolvePricing } from "./costs/pricing.ts";
import { runStatusline } from "./costs/statusline.ts";
import { UsageIndexer } from "./costs/usage-indexer.ts";
import { checkDeps, type DepsEnv } from "./deps/deps.ts";
import { doctorExitCode, formatDeps } from "./deps/format.ts";
import { probeVersion } from "./deps/probe.ts";
import { type OpenCodeState, runDoctor } from "./doctor.ts";
import { buildChildEnv } from "./env.ts";
import { featureOff } from "./errors.ts";
import { type Exec, spawnExec } from "./exec.ts";
import { listAlerts } from "./github/alerts.ts";
import { runGh, runGhIn } from "./github/gh.ts";
import { GithubService } from "./github/service.ts";
import { applyHarness } from "./harness/apply.ts";
import { commitHarness } from "./harness/commit.ts";
import { HarnessDrafts } from "./harness/draft.ts";
import { previewHarness } from "./harness/preview.ts";
import { detectStack } from "./harness/stack.ts";
import { HarnessTemplates } from "./harness/templates-store.ts";
import { HistoryIndexer } from "./history/indexer.ts";
import { Issues } from "./issues/issues.ts";
import { createKnowledgeDoc } from "./knowledge/create.ts";
import { listKnowledge } from "./knowledge/list.ts";
import { knowledgeFeedFor } from "./knowledge/serve.ts";
import { setKnowledgeStatus } from "./knowledge/status.ts";
import { knowledgeSwitchFor } from "./knowledge/switch.ts";
import { linesOf } from "./lines.ts";
import { lingerState } from "./linger.ts";
import { acquireLock, readLockPid } from "./lock.ts";
import { FileLog } from "./logs/file-log.ts";
import { createLogScanner } from "./logs/scanner.ts";
import { restoreBackup } from "./maintenance/backup.ts";
import { Maintenance } from "./maintenance/maintenance.ts";
import { daemonUrl, identityOf, startMcp } from "./mcp.ts";
import { exists } from "./memory/exists.ts";
import { decisionLog, ProjectMemory } from "./memory/memory.ts";
import { runMessageCli } from "./messaging/cli.ts";
import { LocalEndpoints } from "./messaging/endpoints.ts";
import { Idle } from "./messaging/idle.ts";
import { Messaging } from "./messaging/messages.ts";
import { Names } from "./names/names.ts";
import { adoptTitles, type TrackOptions, trackNames, warmKnown } from "./names/track.ts";
import { loopbackOnly, pairingAddress, renderQr, rotateToken, tailscaleIp } from "./pairing.ts";
import { AutoApprover, historyExcludes } from "./permissions/auto-approve.ts";
import { RiskClassifier } from "./permissions/risk.ts";
import { OpenSessionPersonas } from "./personas/open-session.ts";
import { packPersonas } from "./personas/pack.ts";
import { type Prepare, preparePersonas } from "./personas/prepare.ts";
import { agentPublisher } from "./personas/publish.ts";
import { Personas } from "./personas/store.ts";
import { claudeCli, filePins, Plugins, pluginDecisionLog } from "./plugins/plugins.ts";
import { KeepAwake, osPowerContext, type PowerContext } from "./power/keep-awake.ts";
import { QuotaHistory } from "./quota/history.ts";
import { Quota } from "./quota/quota.ts";
import { UsageLedger } from "./quota/usage.ts";
import { ReleaseFeed } from "./releases/releases.ts";
import type { ProcReader } from "./resources/resources.ts";
import { createResources } from "./resources/wiring.ts";
import { Changes } from "./review/changes.ts";
import { ReviewComments } from "./review/comments.ts";
import { ReviewFiles } from "./review/files.ts";
import { SessionCommits } from "./review/session-commit.ts";
import { SessionFiles } from "./review/session-files.ts";
import { SessionPrs } from "./review/session-pr.ts";
import { RoiSignals } from "./roi/signals.ts";
import { RoiSummarizer } from "./roi/summary.ts";
import type { PlatformInfo } from "./roots.ts";
import { RunConfigs } from "./runenv/config.ts";
import { terminalRunHost } from "./runenv/host.ts";
import { RunManager } from "./runenv/manager.ts";
import { CardPorts } from "./runenv/ports.ts";
import { FakeRuntime } from "./runtime/fake-runtime.ts";
import { type FlightdeckMcpServer, flightdeckMcpServer } from "./runtime/flightdeck-mcp.ts";
import { VERIFIED_OPENCODE_VERSION } from "./runtime/opencode-config.ts";
import {
  discoverOpenCode,
  fileExists,
  fileStamp,
  type OpenCodeInfo,
} from "./runtime/opencode-discovery.ts";
import { OpenCodePreflight } from "./runtime/opencode-preflight.ts";
import { OpenCodeModels, runCommand } from "./runtime/opencode-process.ts";
import { OpenCodeRuntime, REAL_KILL_DEPS, treeKiller } from "./runtime/opencode-runtime.ts";
import { scanOpenCodeScope } from "./runtime/opencode-scope.ts";
import { startPrivateServer } from "./runtime/opencode-serve.ts";
import { OPENCODE_LEDGER_FILE, ProcessLedger, procSource } from "./runtime/process-ledger.ts";
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
import { appCanInstallService, installServiceFromApp } from "./service-from-app.ts";
import { killProcess, osServiceContext, processPath } from "./service-os.ts";
import { SessionManager } from "./sessions/session-manager.ts";
import { IdleSleeper } from "./sessions/sleeper.ts";
import { settled } from "./settled.ts";
import { createPrompt, installStableBinary, reconcileStableBinary, runSetup } from "./setup.ts";
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
import { SummaryService } from "./summary/service.ts";
import { Teams } from "./teams/teams.ts";
import { TelemetryOptIn } from "./telemetry/optin.ts";
import type { TelemetryStatus } from "./telemetry/otlp-env.ts";
import { startTelemetry } from "./telemetry/service.ts";
import { TelemetryStore } from "./telemetry/store.ts";
import { teleportImportDeps } from "./teleport/import.ts";
import { TeleportPackages, teleportDeps } from "./teleport/package.ts";
import { TeleportInbox } from "./teleport/receive.ts";
import { BUILTIN_TEMPLATES } from "./templates/builtin.ts";
import { loadTemplates } from "./templates/files.ts";
import { TaskTracker } from "./templates/tasks.ts";
import { claudeSettingsEnv } from "./terminal/claude-settings-env.ts";
import { terminalEnabled } from "./terminal/policy.ts";
import { bunPty, type PtyFactory } from "./terminal/pty.ts";
import { TerminalManager } from "./terminal/terminal-manager.ts";
import { TraceService } from "./trace/service.ts";
import { inspectProject } from "./trust/inspect.ts";
import { ProjectTrust } from "./trust/project-trust.ts";
import {
  binaryVersion,
  refusedAddress,
  requestShutdown,
  runUpdate,
  type StopDeps,
  stableBinPath,
  stopServiceDaemon,
  waitHealthy,
} from "./update.ts";
import { DaemonUpdater } from "./updates/apply.ts";
import { AutoUpdater, autoUpdateOf } from "./updates/auto.ts";
import { UpdateChecker } from "./updates/check.ts";
import { addToUserPath, binDir, removeFromUserPath } from "./user-path.ts";
import { VaultRules } from "./vault/rules-store.ts";
import { Vault } from "./vault/vault.ts";
import { PrFixer } from "./watch/fix.ts";
import { PrWatch } from "./watch/service.ts";
import { Traces } from "./watch/trace.ts";
import { PrWatcher } from "./watch/watch.ts";
import { WebhookSender } from "./webhook/sender.ts";
import { whichOnPath } from "./which.ts";
import { shellCheckRunner } from "./workflows/check-runner.ts";
import { FolderLocks } from "./worktrees/locks.ts";
import { createWorktrees } from "./worktrees/wiring.ts";
import { type WslItem, WslSupervisor } from "./wsl.ts";
import { detectWsl, readProcVersion } from "./wsl-host.ts";

export type ServiceAction = "install" | "uninstall" | "status" | "stop" | "start";

export interface CliArgs {
  command:
    | "start"
    | "pair"
    | "setup"
    | "doctor"
    | "service"
    | "history"
    | "hooks"
    | "telemetry"
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
  /** `setup --yes --folders a,b`: no questions, the folders come from here. */
  yes?: true;
  folders?: string[];
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
  "usage: flightdeckd [start] [--config <file>] [--runtime fake|claude]",
  "     flightdeckd --version",
  "     flightdeckd db prune [--dry-run] [--config <file>]",
  "     flightdeckd backup [--out <file>] [--config <file>]",
  "     flightdeckd restore <file> [--config <file>]   (with the daemon stopped)",
  "     flightdeckd update --from <binary> [--allow-downgrade] [--config <file>]",
  "     flightdeckd setup [--yes --folders <a,b>] [--config <file>]   (guided first run)",
  "     flightdeckd doctor [--config <file>]   (what is missing for it to work, and how to fix it)",
  "     flightdeckd pair [--rotate] [--config <file>]",
  "     flightdeckd service install|uninstall|status|stop|start [--dry-run] [--config <file>]",
  "     flightdeckd history reindex [--config <file>]",
  "     flightdeckd hooks install|uninstall|status [--config <file>]",
  "     flightdeckd telemetry install|uninstall|status [--config <file>]",
  "     flightdeckd hook session-start --url <receiver> --token <token>   (called by Claude Code)",
  "     flightdeckd channel --launch <id> --url <receiver> --token <token>   (the channel's MCP server)",
  "     flightdeckd claude [claude arguments]   (config in FLIGHTDECK_CONFIG)",
  "     flightdeckd askpass <prompt>   (called by ssh through SSH_ASKPASS; config in FLIGHTDECK_CONFIG)",
  "     flightdeckd mcp [--config <file>]   (stdio MCP server for this host's Claude Code)",
  "     flightdeckd statusline [--config <file>]   (one line for Claude Code's statusline)",
  "     flightdeckd message list|send <to> <text>|idle <session>|read <session> [--last N]|team <team>",
  "     flightdeckd action list [--project <id>] [--config <file>]",
  "     flightdeckd action run <name> [--project <id>] [--param key=value ...] [--config <file>]",
  "     flightdeckd snippet list [--project-path <folder>] [--query <text>] [--config <file>]",
  "     flightdeckd snippet get <name> [--project-path <folder>] [--config <file>]",
].join("\n");

const SERVICE_ACTIONS: readonly ServiceAction[] = [
  "install",
  "uninstall",
  "status",
  "stop",
  "start",
];

/** Where the parser is in the command line; a handler reads the words after its own through it. */
class ArgReader {
  private i = 0;
  constructor(private readonly argv: readonly string[]) {}

  /** The word the parser is on, or undefined once the line is read. */
  current(): string | undefined {
    return this.argv[this.i];
  }

  advance(): void {
    this.i++;
  }

  /** The next word, moving onto it. */
  next(): string | undefined {
    return this.argv[++this.i];
  }

  /** The next word, without moving. */
  peek(): string | undefined {
    return this.argv[this.i + 1];
  }

  /** Everything after the current word, which the caller then owns (the parser stops). */
  takeRest(): string[] {
    const rest = this.argv.slice(this.i + 1);
    this.i = this.argv.length;
    return rest;
  }
}

type Handler = (args: CliArgs, reader: ArgReader, value: () => string) => void;

const invalid = (what: string, got: string | undefined, none = "(none)") =>
  new Error(`${what}: ${got ?? none}\n${USAGE}`);

/** The word after a command, which must be one of `allowed`. */
function subAction<T extends string>(
  reader: ArgReader,
  allowed: readonly T[],
  what: string,
  none?: string,
): T {
  const action = reader.next();
  if (action === undefined || !(allowed as readonly string[]).includes(action)) {
    throw invalid(what, action, none);
  }
  return action as T;
}

/** A name after an action (`action run <name>`); it cannot be another flag. */
function operand(reader: ArgReader, what: string): string {
  const next = reader.next();
  if (next === undefined || next.startsWith("--")) throw new Error(`missing ${what}\n${USAGE}`);
  return next;
}

const setCommand =
  (command: CliArgs["command"]): Handler =>
  (args) => {
    args.command = command;
  };

/** A command whose word after it is one of `allowed`, kept in `args.action`. */
const withAction =
  <T extends string>(command: CliArgs["command"], allowed: readonly T[], what: string): Handler =>
  (args, reader) => {
    args.command = command;
    args.action = subAction(reader, allowed, what) as never;
  };

const setValue =
  (set: (args: CliArgs, value: string) => void): Handler =>
  (args, _reader, value) => {
    set(args, value());
  };

const setFlag =
  (set: (args: CliArgs) => void): Handler =>
  (args) => {
    set(args);
  };

/** `action list|run <name>`, `snippet list|get <name>`: the second word may take a name. */
const withNamedAction =
  (
    command: CliArgs["command"],
    allowed: readonly ["list", "run" | "get"],
    what: string,
    nameWhat: string,
    keep: (args: CliArgs, name: string) => void,
  ): Handler =>
  (args, reader) => {
    args.command = command;
    const action = subAction(reader, allowed, what);
    args.action = action as never;
    if (action === allowed[1]) keep(args, operand(reader, nameWhat));
  };

const HANDLERS: Record<string, Handler> = {
  db: (args, reader) => {
    args.command = "db";
    subAction(reader, ["prune"], "invalid db action");
  },
  backup: setCommand("backup"),
  restore: (args, reader) => {
    args.command = "restore";
    const next = reader.peek();
    if (next && !next.startsWith("--")) args.file = reader.next();
  },
  update: setCommand("update"),
  "--version": setCommand("version"),
  start: setCommand("start"),
  pair: setCommand("pair"),
  setup: setCommand("setup"),
  doctor: setCommand("doctor"),
  channel: setCommand("channel"),
  mcp: setCommand("mcp"),
  statusline: setCommand("statusline"),
  service: withAction("service", SERVICE_ACTIONS, "invalid service action"),
  hook: (args, reader) => {
    args.command = "hook";
    const event = reader.next();
    if (event !== "session-start") throw new Error(`invalid hook: ${event ?? "(none)"}`);
  },
  claude: (args, reader) => {
    args.command = "claude";
    args.claudeArgs = reader.takeRest();
  },
  askpass: (args, reader) => {
    args.command = "askpass";
    args.askpassPrompt = reader.takeRest().join(" ");
  },
  hooks: withAction("hooks", ["install", "uninstall", "status"], "invalid hooks action"),
  telemetry: withAction(
    "telemetry",
    ["install", "uninstall", "status"],
    "invalid telemetry action",
  ),
  history: withAction("history", ["reindex"], "invalid history action"),
  action: withNamedAction(
    "action",
    ["list", "run"],
    "invalid action",
    "the action name",
    (args, name) => {
      args.actionName = name;
    },
  ),
  snippet: withNamedAction(
    "snippet",
    ["list", "get"],
    "invalid snippet action",
    "the snippet name",
    (args, name) => {
      args.snippetName = name;
    },
  ),
  message: (args, reader) => {
    args.command = "message";
    const action = subAction(
      reader,
      ["list", "send", "idle", "read", "team"],
      "invalid message action",
    );
    args.action = action as never;
    if (action === "send") {
      args.to = operand(reader, "the session address");
      args.text = operand(reader, "the text");
    }
    if (action === "idle" || action === "read") args.session = operand(reader, "the session");
    if (action === "team") args.team = operand(reader, "the team");
  },
  "--out": setValue((args, v) => {
    args.out = v;
  }),
  "--from": setValue((args, v) => {
    args.from = v;
  }),
  "--allow-downgrade": setFlag((args) => {
    args.allowDowngrade = true;
  }),
  "--yes": setFlag((args) => {
    args.yes = true;
  }),
  "--folders": setValue((args, v) => {
    args.folders = v
      .split(",")
      .map((folder) => folder.trim())
      .filter(Boolean);
  }),
  "--rotate": setFlag((args) => {
    args.rotate = true;
  }),
  "--launch": setValue((args, v) => {
    args.launch = v;
  }),
  "--url": setValue((args, v) => {
    args.url = v;
  }),
  "--token": setValue((args, v) => {
    args.token = v;
  }),
  "--last": setValue((args, v) => {
    const last = Number(v);
    if (!Number.isInteger(last) || last < 1)
      throw new Error(`--last needs a positive integer\n${USAGE}`);
    args.last = last;
  }),
  "--project": setValue((args, v) => {
    args.project = v;
  }),
  "--project-path": setValue((args, v) => {
    args.projectPath = v;
  }),
  "--query": setValue((args, v) => {
    args.query = v;
  }),
  "--param": setValue((args, v) => {
    const [key, ...rest] = v.split("=");
    if (!key || rest.length === 0) throw new Error(`--param needs key=value\n${USAGE}`);
    args.params = { ...args.params, [key]: rest.join("=") };
  }),
  "--dry-run": setFlag((args) => {
    args.dryRun = true;
  }),
  "--config": setValue((args, v) => {
    args.config = v;
  }),
  "--runtime": setValue((args, v) => {
    args.runtime = RuntimeKind.parse(v);
  }),
};

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { command: "start" };
  const reader = new ArgReader(argv);
  for (let arg = reader.current(); arg !== undefined; reader.advance(), arg = reader.current()) {
    const [flag = "", inline] = arg.startsWith("--") ? arg.split("=", 2) : [arg, undefined];
    const value = () => {
      const v = inline ?? reader.next();
      if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value\n${USAGE}`);
      return v;
    };
    const handler = Object.hasOwn(HANDLERS, flag) ? HANDLERS[flag] : undefined;
    if (!handler) throw new Error(`unknown argument: ${arg}\n${USAGE}`);
    handler(args, reader, value);
  }
  return args;
}

/** `hook session-start` gives up on the receptor after this long (the hook's own limit is 5 s). */
export const HOOK_CONNECT_TIMEOUT_MS = 1_000;

/** Exit code when another daemon already owns the same `dataDir`. */
export const EXIT_ALREADY_RUNNING = 3;

export class AlreadyRunningError extends Error {
  constructor(dataDir: string, hint?: string) {
    super(`already running (dataDir ${dataDir})${hint ? `; ${hint}` : ""}`);
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
  /** What the daemon says: the console and, redacted, the log file. */
  logger: Logger;
}

interface CreatedRuntime {
  runtime: AgentRuntime;
  /** What `host.info` reports about `claude`; only the real runtime has one. */
  claude?: { path: string | null; version(): Promise<string | null> };
  /** What the account card reads (phase 34); the real runtime asks its `claude`, the fake one answers a demo account. */
  accountReaders?: ReturnType<typeof accountReaders>;
}

async function createRuntime(
  kind: RuntimeKind,
  claudePath?: string,
  mcpServer?: FlightdeckMcpServer,
): Promise<CreatedRuntime> {
  if (kind === "fake") return { runtime: new FakeRuntime(), accountReaders: demoAccountReaders() };
  const { ClaudeSdkRuntime } = await import("./runtime/claude-sdk-runtime.ts");
  const runtime = new ClaudeSdkRuntime({
    ...(claudePath ? { claudePath } : {}),
    ...(mcpServer ? { mcpServer } : {}),
  });
  const path = runtime.claudePath ?? null;
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  return {
    runtime,
    claude: { path, version: claudeVersionProbe(path, spawnExec) },
    accountReaders: accountReaders({
      claudePath: path,
      exec: spawnExec,
      query: query as unknown as Parameters<typeof accountReaders>[0]["query"],
    }),
  };
}

/** Phase 39: what the host offers of OpenCode: whether it runs here, its runtime and its models. */
interface CreatedOpenCode {
  info: OpenCodeInfo;
  runtime?: AgentRuntime;
  models?: () => Promise<Array<{ id: string; name: string }>>;
}

/** Phase 39: the fake host's OpenCode, for the demo and the journeys. */
function fakeOpenCode(): CreatedOpenCode {
  const models = [
    "anthropic/claude-sonnet-5-5",
    "openai/gpt-6.1-sol",
    "opencode/crouton-alpha-free",
  ];
  return {
    info: { available: true, path: "fake", version: VERIFIED_OPENCODE_VERSION, verified: true },
    runtime: new FakeRuntime(),
    models: () => Promise.resolve(models.map((id) => ({ id, name: id }))),
  };
}

/** Phase 39: OpenCode as discovery finds it on this host (it runs the binary: only when turned on). */
function discoverHost(config: Config, childEnv: Record<string, string>): Promise<OpenCodeInfo> {
  return discoverOpenCode(config.opencode, {
    env: childEnv,
    platform: process.platform,
    dataDir: config.dataDir,
    which: (bin) => Bun.which(bin, { PATH: childEnv.PATH ?? "" }),
    exists: fileExists,
    run: runCommand,
    scan: () => scanOpenCodeScope({ env: childEnv }),
    statFile: fileStamp,
  });
}

/** Phase 39: the doctor's OpenCode row: looked up without running it, discovered only when on. */
async function openCodeState(
  config: Config,
  env: Record<string, string | undefined>,
  known?: OpenCodeInfo,
): Promise<OpenCodeState> {
  const childEnv = buildChildEnv(env, config.allowApiKey);
  const enabled = config.opencode.enabled;
  return {
    enabled,
    found: Bun.which("opencode", { PATH: childEnv.PATH ?? "" }),
    info: enabled ? (known ?? (await discoverHost(config, childEnv))) : null,
    platform: process.platform,
  };
}

/**
 * Phase 39: finds and checks OpenCode when the host turned it on (it runs the binary), then builds
 * its preflight, its runtime and its model list.
 */
async function createOpenCode(
  config: Config,
  kind: RuntimeKind,
  env: Record<string, string | undefined>,
  mcpServer: FlightdeckMcpServer,
  /** Why a preflight failed (the route and its exit code). */
  log: (message: string) => void,
): Promise<CreatedOpenCode> {
  // The demo and the journeys show the picker with a fake OpenCode, which runs nothing.
  if (kind === "fake") return fakeOpenCode();
  // A daemon that was killed leaves the commands its OpenCode sessions ran: reaped first, even
  // when OpenCode is off now (issue #250).
  const ledger = new ProcessLedger({
    file: join(config.dataDir, OPENCODE_LEDGER_FILE),
    proc: procSource(),
    killGroup: REAL_KILL_DEPS.killGroup,
  });
  const left = await ledger.reap();
  if (left.reaped.length > 0) {
    log(`OpenCode: ${left.reaped.length} process group(s) left by an earlier daemon were ended`);
  }
  if (!config.opencode.enabled) return { info: { available: false, reason: "opencode_disabled" } };
  const childEnv = buildChildEnv(env, config.allowApiKey);
  const scan = () => scanOpenCodeScope({ env: childEnv });
  const info = await discoverHost(config, childEnv);
  const { path, version } = info;
  if (!info.available || !path || !version) return { info };
  const preflight = new OpenCodePreflight({
    path,
    version,
    env: childEnv,
    // One private server per preflight, in the process groups the ledger knows (issue #243).
    serve: (opts) => startPrivateServer({ path, ledger, ...opts }),
    scan,
    log,
    // An executable discovery could not stamp is never trusted: the preflight refuses opencode_changed.
    exe: { fingerprint: info.fingerprint ?? "", current: () => fileStamp(path) },
  });
  const runtime = new OpenCodeRuntime({
    path,
    version,
    preflight,
    scan,
    kill: treeKiller(process.platform, REAL_KILL_DEPS),
    mcpServer,
    ledger,
  });
  const models = new OpenCodeModels({
    path,
    env: childEnv,
    dataDir: config.dataDir,
    run: runCommand,
    scan,
  });
  return { info, runtime, models: () => models.list() };
}

/** What "Abrir no terminal" needs (phase 8): the stable binary when installed, the WSL distro. */
async function terminalInfo(env: Record<string, string | undefined>) {
  const stable = stableBinPath(userHome(env), process.platform);
  return {
    flightdeckdPath: (await stat(stable).then(
      () => true,
      () => false,
    ))
      ? stable
      : null,
    wslDistro: env.WSL_DISTRO_NAME || null,
  };
}

/** Loads the config, opens the store and starts serving. The token is never logged. */
export async function startDaemon(
  args: CliArgs,
  env: Record<string, string | undefined>,
  console_: Logger,
  options: {
    configWatchMs?: number;
    /** Where the daemon writes its log; `~/.flightdeck/logs` when absent (tests give a temp folder). */
    logDir?: string;
    /** What decides the system folders `roots.add` refuses (tests give their own). */
    rootsPlatform?: PlatformInfo;
    wslCommand?: (item: WslItem) => string[];
    /** What `daemon.shutdown` triggers; the command is refused without it. */
    onShutdown?: () => void;
    /** The PTY terminals run in; Bun's own when absent (tests inject a fake). */
    pty?: PtyFactory;
    /** Where `resources.get` reads processes from; the real /proc on Linux when absent (tests inject a fake). */
    resourcesProc?: ProcReader;
    /** How the project key asks git; the process itself when absent (tests hold it). */
    projectGit?: AsyncGitRunner;
    /** Whether the OS service is installed, for `doctor.run`; the real service manager when absent. */
    serviceInstalled?: () => Promise<boolean>;
    /** Whether linger is on, for `doctor.run`; `loginctl` when absent. */
    linger?: () => Promise<"on" | "off" | null>;
    /** The machine's service manager, for the probes above when they are not given; the real one when absent. */
    serviceContext?: (dryRun: boolean) => ServiceContext;
    /** The command line of this daemon, for `service.install` (#1200); its own when absent. */
    serviceSelf?: string[];
    /** Whether a port is free, for the cards' blocks; the real loopback probe when absent. */
    portProbe?: (port: number) => Promise<boolean>;
    /** What keeps the computer awake (issue #163); the machine's own when absent. */
    powerContext?: PowerContext;
  } = {},
): Promise<Daemon> {
  const configFile = configPath(args);
  const config = await loadConfig(configFile);
  // Everything the daemon says goes to the console and, redacted, to a rotated file.
  // What the log must never write: the daemon's tokens (the protocol's rotates) and what the vault
  // holds. The vault is made further down; until then there is nothing held.
  let currentToken = config.token;
  let heldValues: () => string[] = () => [];
  const fileLog = new FileLog({
    dir: options.logDir ?? join(userHome(env), ".flightdeck", "logs"),
    home: userHome(env),
    scanner: createLogScanner({
      tokens: () => [config.token, currentToken, config.hooks.token ?? ""].filter(Boolean),
      vaultValues: () => heldValues(),
    }),
  });
  const logger: Logger = {
    log: (message) => {
      console_.log(message);
      fileLog.write("info", message);
    },
    error: (message) => {
      console_.error(message);
      fileLog.write("error", message);
    },
  };
  const runtimeKind = args.runtime ?? config.runtime;
  // Before SQLite and the port: a second daemon must not touch either.
  const lock = await acquireLock(config.dataDir);
  if (!lock) throw new AlreadyRunningError(config.dataDir);
  const store = await EventStore.open(join(config.dataDir, "flightdeck.db"));
  const claudePath = config.claude?.executablePath ?? config.claudePath;
  const mcpServer = flightdeckMcpServer(daemonCommand(process.execPath, Bun.main), configFile);
  const {
    runtime,
    claude,
    accountReaders: readers,
  } = await createRuntime(runtimeKind, claudePath, mcpServer);
  // Phase 39: OpenCode, when this host turned it on.
  const opencode = await createOpenCode(
    config,
    runtimeKind,
    env,
    mcpServer,
    logger.log.bind(logger),
  );
  // The plan quota is the host's: every managed session feeds it (phase 7).
  const quota = new Quota({ pauseAt: config.quota.pauseAt });
  const quotaHistory = new QuotaHistory({ db: store.db });
  // Phase 34: who the host's own `claude` is signed in to, for the account card.
  const account = readers ? new Account({ quota, readers }) : undefined;
  const keys = new ProjectKeys(config.hostName, options.projectGit);
  // The turn is counted when git has answered: a slow git must not stop the daemon meanwhile.
  const usage = new UsageLedger({ db: store.db, projectKey: (cwd) => keys.lookup(cwd) });
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
  const awake: {
    pinned?: (claudeSessionId: string | null) => boolean;
    cardSession?: (sessionId: string) => boolean;
  } = {};
  // Holds the computer awake while a session runs or waits for a permission (issue #163).
  const keepAwake = new KeepAwake(options.powerContext ?? osPowerContext(), config.keepAwake);

  // Folders a worktree removal holds: nothing starts in one while it is being removed.
  const folderLocks = new FolderLocks();

  // Whether a folder's own hooks, MCP servers and settings may load in a session (issue #196): only
  // where the person trusted it (or already worked in it before this existed). A card's worktree is
  // read from its project's main checkout.
  const projectTrust = new ProjectTrust(store.db, {
    roots: () => config.allowedRoots,
    configRootOf: (cwd) => {
      const found = board.projectForCwd(cwd);
      return found?.card ? found.project.path : null;
    },
    log: (line) => logger.log(line),
  });
  // The library's index (#76) goes to a trusted folder only, read from its trusted checkout.
  const trustForKnowledge = async (path: string) => {
    await projectTrust.prepare(path);
    return projectTrust.sessionTrust(path);
  };
  const manager = new SessionManager({
    folderLocks,
    store,
    runtime,
    risk,
    onActivity: (active) => keepAwake.update(active),
    trust: projectTrust.sessionTrust.bind(projectTrust),
    prepareTrust: projectTrust.prepare.bind(projectTrust),
    autoApprove,
    allowedRoots: config.allowedRoots,
    defaultPermissionMode: config.defaultPermissionMode,
    allowApiKey: config.allowApiKey,
    allowBypass: () => config.allowBypassPermissions,
    // A pinned session and a card's stay awake; filled in below, once the board and the meta exist.
    keepAwake: (session) =>
      awake.pinned?.(session.claudeSessionId) === true || awake.cardSession?.(session.id) === true,
    baseEnv: env,
    ...(opencode.runtime ? { opencode: opencode.runtime } : {}),
    onQuota: (readings) => {
      quota.record(readings);
      quotaHistory.sample(readings);
    },
    onTurn: (sessionId, cwd, turn, runtime) => {
      usage.record(sessionId, cwd, turn);
      // The account card reads the Claude plan; an OpenCode turn spends none of it.
      if (runtime === "claude") account?.turnEnded();
    },
    onTurnEdge: (edge) =>
      snapshots.enqueue({
        cwd: edge.cwd,
        claudeSessionId: edge.claudeSessionId,
        kind: edge.kind,
        ...(edge.prompt !== undefined ? { prompt: edge.prompt } : {}),
        ...(edge.turnUuid !== undefined ? { turnUuid: edge.turnUuid } : {}),
      }),
  });
  const rewinder = new Rewinder({ snapshots, sessions: manager });
  // Phase 21: every session of this host has a standard name and an alias that addresses it.
  const names = new Names(store.db);
  const history = new HistoryIndexer({
    db: store.db,
    roots: config.history.roots,
    excludeCwds: historyExcludes(config),
    log: (m) => logger.log(m),
    // Issue #605: the name Claude Code gave a session (`--name`, `/rename`) is its name here too.
    onTitle: adoptTitles(names, manager),
    ...(config.history.scanIntervalMs ? { scanIntervalMs: config.history.scanIntervalMs } : {}),
  });
  history.start();
  // Issue #100: the packages of the sessions this host teleports to another; none outlives a run.
  const teleport = new TeleportPackages(
    teleportDeps({
      manager,
      names,
      indexer: history,
      historyRoots: config.history.roots,
      dataDir: config.dataDir,
      scan: snippetScanner.scan.bind(snippetScanner),
      log: logger.log.bind(logger),
    }),
  );
  await teleport.start();
  // The packages other hosts send to this one (slice 2a); none outlives a run either.
  const teleportInbox = new TeleportInbox({
    dir: join(config.dataDir, "teleport-in"),
    now: Date.now,
    newId: randomUUID,
    timers: globalThis,
  });
  await teleportInbox.start();
  // Usage of every session of the host, from the transcripts (phase 8): first the ones that
  // already exist, in the background, then whatever the history index sees changing.
  const costs = new Costs({
    db: store.db,
    pricing: resolvePricing(config.pricing),
    loadPricing: async () => resolvePricing((await loadConfig(configFile)).pricing),
    initialLoad: () => usageIndex.status(),
  });
  const usageIndex = new UsageIndexer({
    db: store.db,
    roots: config.history.roots,
    excludeCwds: historyExcludes(config),
    projectKey: (cwd) => keys.known(cwd),
    warmKeys: (cwds) => Promise.all(cwds.map((cwd) => keys.resolve(cwd))),
    cost: (tokens) => costs.cost(tokens),
    log: (m) => logger.log(m),
    onPass: () => budgets.evaluate(),
  });
  const budgets = new Budgets({ db: store.db });
  budgets.start();
  history.onChange(() => usageIndex.request());
  usageIndex.start();
  const prepare: Prepare = (ref, cwd) => preparePersonas(personaStore, ref, cwd);
  const board = new Board({
    folderLocks,
    preparePersonas: prepare,
    // Issue #78: a card's spec template comes from a trusted project's trusted checkout only.
    specTemplateRoot: async (cwd, own) =>
      templateRootOf(await trustForKnowledge(cwd), own ? cwd : undefined),
    log: (line) => logger.log(line),
    db: store.db,
    manager,
    quota,
    // What goes public from a card (a PR, a merge message) is also checked against the vault's values.
    scanner: new SecretScanner(() => heldValues()),
    allowedRoots: config.allowedRoots,
    maxParallelRuns: config.maxParallelRuns,
    budgets,
    projectKeys: keys,
    cardCost: costs.card.bind(costs),
    // A worktree is removed once no snapshot runs git in it (a busy folder on Windows).
    idle: snapshots.idle.bind(snapshots),
    // A card raised from an agent's findings keeps automatic approval off (issue #79).
    suspendApproval: autoApprove.suspendCard.bind(autoApprove),
    ...(config.board.prPollIntervalMs ? { prPollIntervalMs: config.board.prPollIntervalMs } : {}),
    // Changed from the app: kept in the config file, like the rest of the host settings.
    onSettingsChange: ({ maxParallelRuns }) =>
      updateConfigFile(configFile, (raw) => ({ ...raw, maxParallelRuns })),
  });
  // The key of every project is looked up in the background, so the budget check and the vault
  // find it cached when the first card starts.
  void board.warmProjectKeys();
  // The diff of every session and card, for the review (phase 11).
  // Real shells behind a PTY, kept across connections; none outlives the daemon.
  const terminals = new TerminalManager({
    folderLocks,
    pty: options.pty ?? bunPty(),
    enabled: terminalEnabled(config.bind, config.terminal.enabled),
    allowedRoots: config.allowedRoots,
    max: config.terminal.max,
    idleMinutes: config.terminal.idleMinutes,
    allowApiKey: config.allowApiKey,
    // "Claude aqui" runs this very daemon's `claude`, with this config.
    claude: { self: daemonCommand(process.execPath, Bun.main), configFile },
    claudeEnv: () => claudeSettingsEnv(claudeSettingsPath()),
    log: (message) => logger.log(message),
  });
  const changes = new Changes({
    db: store.db,
    board,
    log: logger.log.bind(logger),
    // A terminal's folder is a target of the Files viewer (#506).
    terminals,
    // A project's checkout is one too, inside these (#797).
    allowedRoots: config.allowedRoots,
  });
  // #1133: a plain session's changes committed on a new branch in its own checkout.
  const sessionCommits = new SessionCommits({
    changes,
    scanner: snippetScanner,
    isCardWorktree: (root) => board.projectForCwd(root)?.card != null,
  });
  // #1133: the branch a session's commit made, pushed and opened as a PR.
  const sessionPrs = new SessionPrs({
    changes,
    commits: sessionCommits,
    scanner: snippetScanner,
    isCardWorktree: (root) => board.projectForCwd(root)?.card != null,
    projectProvider: (root) => board.projectForCwd(root)?.project.prProvider ?? null,
  });
  const issues = new Issues({ board, autoApprove });
  // Phase 38: the boards of GitHub Projects, read through the host's gh and synced on a timer.
  const boardSyncStore = new BoardSyncStore(store.db);
  const boardProvider = new GithubBoards({ gh: runGh });
  const boardEngine = new BoardSync({
    board,
    store: boardSyncStore,
    provider: boardProvider,
    autoApprove,
  });
  const boardLoop = new BoardSyncLoop({
    engine: boardEngine,
    store: boardSyncStore,
    timers: { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id as Timer) },
  });
  // Phase 22: the PRs of the cards are watched and fixed, inside their limits (before the
  // automations: a watched PR is the watch's alone, #77).
  const prWatcher = new PrWatcher({
    db: store.db,
    board,
    onTrigger: (trigger) => prFixer.onTrigger(trigger),
  });
  const prFixer = new PrFixer({
    db: store.db,
    board,
    watcher: prWatcher,
    checks: shellCheckRunner(),
    onUpdate: (cardId) => prWatch.notify(cardId),
  });
  // Phase 13: they listen to the board's PR polling for `ci_failed`, and run the schedule.
  const automations = new Automations({
    db: store.db,
    board,
    issues,
    autoApprove,
    pollMs: config.automations.issuePollIntervalMs,
    log: logger.log.bind(logger),
    // Issue #77: a card whose PR is watched is fixed by the watch alone.
    prWatch: prFixer,
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
  await maintenance.start();
  // Issue #280: a newer version is applied by itself, only while nothing runs on the host. Made
  // after the checker, which tells it after each check.
  let autoUpdater: AutoUpdater | undefined;
  // Checked in the background: a slow or unreachable release server never delays the boot.
  const updates = config.updates.manifestUrl
    ? new UpdateChecker({
        manifestUrl: config.updates.manifestUrl,
        checkIntervalH: config.updates.checkIntervalH,
        currentVersion: DAEMON_VERSION,
        onChecked: () => autoUpdater?.checked(),
      })
    : undefined;
  const updater = updates
    ? new DaemonUpdater({
        manifest: () => updates.latest(),
        dataDir: config.dataDir,
        ctx: osServiceContext(false),
      })
    : undefined;
  if (updates && updater) {
    autoUpdater = new AutoUpdater({
      enabled: () => config.updates.auto,
      currentVersion: DAEMON_VERSION,
      latest: updates.latest.bind(updates),
      idle: () => manager.activeSessionCount() === 0 && board.workflows.activeRuns().length === 0,
      apply: (proceed) => updater.apply(true, { proceed }),
      log: logger.log.bind(logger),
    });
  }
  void updates?.start();
  // Phase 23: the events of Claude Code's OTLP exporter, for the sessions of terminals.
  const telemetryStore = new TelemetryStore(store.db);
  const telemetry = await startTelemetry({
    config,
    configFile,
    log: { error: (message) => logger.error(message) },
    onEvents: (events) => {
      telemetryStore.add(events);
    },
    purge: () => {
      telemetryStore.prune(config.telemetry.retentionDays, Date.now());
    },
  });
  const central = new Central({
    risk,
    autoApprove,
    snapshots,
    db: store.db,
    keys,
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
  const sshAskpass = await askpassHook({
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
      (await resolveSshPath({ platform: process.platform, exists, which: whichOnPath })),
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
  heldValues = () => vault.heldValues();
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
    projectKey: (id) => keys.known(board.getProject(id).path),
  });
  // Phase 21: messages between sessions, delivered here and carried between hosts by the app.
  const endpoints = new LocalEndpoints({
    manager,
    external: central.external,
    nameOf: (claudeSessionId) => central.meta.get(claudeSessionId).name,
    projectKey: (cwd) => keys.known(cwd),
    cardOf: (sessionId) => board.projectForCwd(manager.get(sessionId).cwd)?.card?.id ?? null,
    sendToLaunch: central.sendToLaunch.bind(central),
    autoApprove,
  });
  // The messaging service asks the teams who is on one, and the teams need the messaging service.
  let teams: Teams | undefined;
  const messaging = new Messaging({
    db: store.db,
    host: config.hostName,
    endpoints,
    names,
    teamOf: (sessionId) => teams?.teamOf(sessionId) ?? null,
  });
  // Phase 20's personas reach the team: the coordinator and each worker open in theirs.
  const personaSessions = new OpenSessionPersonas({ personas: personaStore, manager, central });
  teams = new Teams({
    db: store.db,
    board,
    manager,
    messaging,
    host: config.hostName,
    quota,
    names,
    personas: {
      resolve: async (id) => {
        try {
          return { id, name: (await personaStore.resolve({ id }, {})).persona.name };
        } catch {
          return null;
        }
      },
    },
    bypassAllowed: () => config.allowBypassPermissions,
    startCoordinator: async ({ cwd, prompt, name, persona, model, permissionMode }) => {
      const ref = persona ? { id: persona } : undefined;
      return manager.create(
        {
          cwd,
          prompt,
          name,
          ...(ref ? { persona: ref } : {}),
          ...(model ? { model } : {}),
          ...(permissionMode ? { permissionMode } : {}),
        },
        { prepared: await prepare(ref, cwd) },
      );
    },
    // The worker's model travels on its card (see `Teams.startWorker`).
    startWorker: (cardId, persona) =>
      board.startCard(cardId, persona ? { persona: { id: persona } } : {}),
    warm: (cwd) => warmKeys(cwd),
    applyPersona: (sessionId, persona) => {
      const done = persona
        ? personaSessions.apply({ sessionId, persona: { id: persona } })
        : personaSessions.clear({ sessionId });
      // A session that ended keeps the persona it had; the team still records the new one.
      void done.catch(() => {});
    },
  });
  // Of a managed session only: the id of a terminal session is not one the manager knows.
  const cardOf = (sessionId: string) => {
    const cwd = manager.list().find((s) => s.id === sessionId)?.cwd;
    return cwd ? (board.projectForCwd(cwd)?.card?.id ?? null) : null;
  };
  // A session is named after its project, or after the card's project when it runs in a worktree.
  const keyedPath = (cwd: string) => board.projectForCwd(cwd)?.project.path ?? cwd;
  // Both folders, without blocking: naming, lists and messages read their keys right after. Nothing
  // back when both are known, so whoever starts a session can read its name at once.
  const warmKeys = (cwd: string) => {
    const looked = [cwd, keyedPath(cwd)].map((folder) => keys.lookup(folder));
    return looked.every((key) => typeof key === "string")
      ? undefined
      : Promise.all(looked.map((key) => Promise.resolve(key)));
  };
  const nameOptions: TrackOptions = {
    names,
    manager,
    external: central.external,
    projectOf: (cwd) => keys.known(keyedPath(cwd)),
    warm: warmKeys,
    cardOf,
    personaOf: (sessionId) => {
      const card = cardOf(sessionId);
      return card ? (teams?.personaOfCard(card) ?? null) : null;
    },
    // Issue #101: a worker's session is named with its team, role and number from the start.
    ...(teams ? { teamOfCard: teams.teamOfCard.bind(teams) } : {}),
  };
  await warmKnown(nameOptions);
  const stopNames = trackNames(nameOptions);
  const traces = new Traces({
    scanner: snippetScanner,
    db: store.db,
    board,
    fixer: prFixer,
    claudeSessionOf: (sessionId) => manager.get(sessionId).claudeSessionId,
    describeSession: (sessionId) => ({
      name: manager.get(sessionId).name,
      request:
        store
          .eventsSince(sessionId, 0)
          .map((envelope) => envelope.event)
          .flatMap((event) => (event.type === "message.user" ? [event.text] : []))[0] ?? null,
    }),
    sessionCosts: (ids) => costs.sessions(ids),
    cardCost: (cardId) => costs.card(cardId),
    checkpoints: (claudeSessionId) => snapshots.list(claudeSessionId).length,
    search: (query) => {
      const seen = new Map<
        string,
        { claudeSessionId: string; title: string | null; cwd: string }
      >();
      for (const hit of history.search({ query: `"${query.replaceAll('"', "")}"`, limit: 20 })) {
        seen.set(hit.claudeSessionId, {
          claudeSessionId: hit.claudeSessionId,
          title: hit.title,
          cwd: hit.cwd,
        });
      }
      return [...seen.values()];
    },
  });
  const prWatch = new PrWatch({ board, watcher: prWatcher, fixer: prFixer, traces });
  prWatch.start();
  // Phase 24: each card's run.yaml (scripts, a block of ports, a preview), through the terminals.
  const runConfigs = new RunConfigs({ db: store.db });
  const cardPorts = new CardPorts({
    db: store.db,
    base: config.run.portBase,
    ...(options.portProbe ? { isFree: options.portProbe } : {}),
  });
  const runManager = new RunManager({
    db: store.db,
    configs: runConfigs,
    ports: cardPorts,
    host: terminalRunHost(terminals),
    card: (id) => board.getCard(id),
    project: (id) => board.getProject(id),
  });
  // A card that is done stops its processes and gives its ports back.
  const unwatchRunEnv = [
    cardPorts.follow((listener) => board.watch(listener)),
    runManager.follow((listener) => board.watch(listener)),
  ];
  // A worktree is not removed while a card's processes are still being ended.
  board.addIdle(runManager.idle.bind(runManager));
  // A discarded card ends its processes first: a live tree locks the files of its worktree.
  board.addEnd((cardId) => runManager.stop(cardId));
  const idle = new Idle({ endpoints, messaging, host: config.hostName });
  const messagingSweep = setInterval(messaging.sweep.bind(messaging), 5 * 60_000);
  awake.pinned = (claudeSessionId) =>
    claudeSessionId !== null && central.meta.get(claudeSessionId).pinned;
  awake.cardSession = (sessionId) => board.hasRunSession(sessionId);
  // Idle sessions give back their process after N minutes (off by default: no timer then).
  const sleeper = new IdleSleeper({ manager, minutes: config.sessions.sleepAfterMinutes });
  // The wrapper finds the receptor through this file: nothing is served before it is there.
  await central.ready();
  // A session that was open before the restart may be sent a message before anything else looks
  // at its folder: read the git boundaries of every folder first, so the lazy reattach finds them.
  // `prepare` answers every filesystem error itself (a folder it cannot read is a boundary).
  await projectTrust.prepareSessions(manager.list());
  // Phase 40: the AI assistant on this host's claude (the fake runtime answers in the demo).
  // Issue #75, slice G1: CLAUDE.md drafts on this host's claude, held by digest until applied.
  const harnessDrafts = new HarnessDrafts({
    complete: (opts) =>
      runtime.complete ? runtime.complete(opts) : Promise.reject(featureOff("harnessDraft")),
    quota,
    scanner: snippetScanner,
    cwd: assistantDir(config.dataDir),
    allowApiKey: config.allowApiKey,
  });
  const assistant = assistantService({
    runtime,
    usage: usageIndex,
    quota,
    scanner: snippetScanner,
    board,
    allowedRoots: config.allowedRoots,
    dataDir: config.dataDir,
    allowApiKey: config.allowApiKey,
    log: logger.log.bind(logger),
  });
  /** A folder's trust as the clients see it, with the live sessions that still run with the setup they loaded (issue #463). */
  const trustState = (path: string) => {
    const via = projectTrust.via(path);
    const stale = manager.staleSessions(path);
    return { path, trusted: via !== null, via, ...(stale > 0 ? { staleSessions: stale } : {}) };
  };
  const server = startServer({
    manager,
    opencode: {
      info: () => opencode.info,
      models: () => (opencode.models as NonNullable<CreatedOpenCode["models"]>)(),
    },
    ...(assistant ? { assistant } : {}),
    teleport,
    teleportInbox,
    teleportImport: teleportImportDeps({
      inbox: teleportInbox,
      allowedRoots: config.allowedRoots,
      historyRoots: config.history.roots,
      indexer: history,
      manager,
      meta: central.meta,
    }),
    warmProjectKey: (cwd) => keys.resolve(cwd),
    projectKeyOf: (cwd) => keys.resolve(cwd),
    // `roots.add` pushes into this same array, so every service sees the new folder at once.
    ...(options.rootsPlatform ? { rootsPlatform: options.rootsPlatform } : {}),
    bypass: {
      allowed: () => config.allowBypassPermissions,
      set: async (allow) => {
        config.allowBypassPermissions = allow;
        await updateConfigFile(configFile, (raw) => ({ ...raw, allowBypassPermissions: allow }));
      },
    },
    sleep: {
      minutes: () => sleeper.minutes(),
      set: async (minutes) => {
        sleeper.setMinutes(minutes);
        await updateConfigFile(configFile, (raw) => ({
          ...raw,
          sessions: { ...(raw.sessions as object | undefined), sleepAfterMinutes: minutes },
        }));
      },
    },
    keepAwake: {
      status: () => keepAwake.status(),
      set: async (enabled) => {
        // The file first: when it cannot be written the switch stays as it was, for the client and the daemon.
        await updateConfigFile(configFile, (raw) => ({ ...raw, keepAwake: enabled }));
        config.keepAwake = enabled;
        keepAwake.setEnabled(enabled);
      },
    },
    harnessStack: detectStack,
    alerts: (cwd) => listAlerts(runGhIn, cwd),
    knowledge: listKnowledge,
    knowledgeStatus: setKnowledgeStatus,
    knowledgeCreate: createKnowledgeDoc,
    knowledgeFeed: knowledgeFeedFor({
      off: () => config.knowledge.feedOff,
      trust: trustForKnowledge,
    }),
    knowledgeFeedSwitch: knowledgeSwitchFor({
      off: () => config.knowledge.feedOff,
      trust: trustForKnowledge,
      change: async (update) => {
        let next: string[] = [];
        await updateConfigFile(configFile, (raw) => {
          const section = (typeof raw.knowledge === "object" ? raw.knowledge : null) ?? {};
          const listed = (section as { feedOff?: unknown }).feedOff;
          const entries = Array.isArray(listed) ? listed.filter((e) => typeof e === "string") : [];
          next = update(entries);
          return { ...raw, knowledge: { ...section, feedOff: next } };
        });
        config.knowledge.feedOff = next.map((entry) => resolve(expandHome(entry)));
      },
    }),
    harnessPreview: previewHarness,
    harnessApply: (path, parts, digests, options) =>
      applyHarness(path, parts, digests, { ...options, drafts: harnessDrafts }),
    // Only a runtime that can run a one-shot drafts: the feature is not offered otherwise.
    ...(runtime.complete ? { harnessDraft: (path: string) => harnessDrafts.draft(path) } : {}),
    harnessCommit: (path, digests) => commitHarness(path, digests, { scanner: snippetScanner }),
    harnessTemplates: new HarnessTemplates(
      join(config.dataDir, "harness-templates"),
      snippetScanner,
    ),
    projectTrust: {
      refresh: projectTrust.refreshRoots.bind(projectTrust),
      state: (paths) => paths.map(trustState),
      inspect: (path) => inspectProject(path),
      set: (path, trusted) => {
        if (trusted) projectTrust.trust(path);
        else projectTrust.revoke(path);
        // The live sessions that loaded the setup say again whether it is still theirs (issue #463).
        manager.trustChanged();
        return trustState(path);
      },
    },
    persistRoots: (roots) =>
      updateConfigFile(configFile, (raw) => ({ ...raw, allowedRoots: [...roots] })),
    fsDirs: true,
    findProjects: true,
    // Sign-in with GitHub through the host's gh, and start from a repo or an issue (phase 37).
    roi: new RoiSummarizer({
      db: store.db,
      keyOf: (path) => keys.known(path),
      signals: new RoiSignals(),
    }),
    boardsync: new BoardSyncService({
      board,
      store: boardSyncStore,
      provider: boardProvider,
      engine: boardEngine,
      loop: boardLoop,
    }),
    github: new GithubService({
      roots: config.allowedRoots,
      board,
      issues,
      startSession: ({ cwd, prompt, name }) => manager.create({ cwd, prompt, name }),
    }),
    serviceInstall: appServiceInstall(
      args.config ?? null,
      configFile,
      options.serviceContext ?? osServiceContext,
      options.serviceSelf ?? daemonCommand(process.execPath, Bun.main),
    ),
    // The daemon answers for itself: the live roots (`roots.add` pushes into this array), the
    // folders checked without blocking, and the app's version to compare with its own.
    doctor: (appVersion) =>
      runDoctor({
        config: () => ({ bind: config.bind, port: config.port, allowedRoots: config.allowedRoots }),
        isDirectory: async (path) => (await stat(path).catch(() => null))?.isDirectory() === true,
        serviceInstalled:
          options.serviceInstalled ??
          (async () =>
            (await serviceCommand((options.serviceContext ?? osServiceContext)(false))) !== null),
        healthy: () => Promise.resolve(true),
        mcp: () => mcpReachable(daemonCommand(process.execPath, Bun.main)),
        opencode: () => openCodeState(config, env, opencode.info),

        linger:
          options.linger ??
          (() => lingerState((options.serviceContext ?? osServiceContext)(false))),
        tailscaleIp: () => tailscaleIp(spawnExec),
        hooks: () =>
          hooksStatus(
            claudeSettingsPath(),
            hookTarget(config, daemonCommand(process.execPath, Bun.main)),
          ),
        claudePath: () => claude?.path ?? whichOnPath("claude"),
        templateProblems: async () =>
          (
            await loadTemplates({
              dir: join(config.dataDir, "templates"),
              builtins: BUILTIN_TEMPLATES,
            })
          ).problems,
        version: { daemon: DAEMON_VERSION, ...(appVersion ? { app: appVersion } : {}) },
      }),
    // The dependencies of this host: the same probes as the doctor, the program on the PATH and its version.
    deps: () =>
      checkDeps({
        platform: process.platform,
        // Like host.info: the path `flightdeckd setup` wrote, since a service's PATH does not see claude.
        which: async (name) => {
          const configured = name === "claude" ? claudePath : undefined;
          if (!configured) return whichOnPath(name);
          return (await Bun.file(configured).exists()) ? configured : null;
        },
        version: (path) => probeVersion([path, "--version"]),
        allowedRoots: config.allowedRoots,
        serviceInstalled:
          options.serviceInstalled ??
          (async () =>
            (await serviceCommand((options.serviceContext ?? osServiceContext)(false))) !== null),
        linger:
          options.linger ??
          (() => lingerState((options.serviceContext ?? osServiceContext)(false))),
        account: async () => (await account?.get())?.status ?? null,
        hooks: () =>
          hooksStatus(
            claudeSettingsPath(),
            hookTarget(config, daemonCommand(process.execPath, Bun.main)),
          ),
      }),
    sessionSettings: true,
    messaging,
    names,
    idle,
    teams,
    watch: prWatch,
    vault,
    log: logger.log.bind(logger),
    actions,
    autoApprove,
    issues,
    automations,
    history,
    board,
    runenv: { configs: runConfigs, manager: runManager },
    quota,
    usage,
    costs,
    telemetry: telemetryStore,
    bg: new BgService({
      db: store.db,
      claude: () => config.claude?.executablePath ?? whichOnPath("claude") ?? null,
      channel: (claudeSessionId, text) => messageExternal(central, claudeSessionId, text),
      trust: projectTrust.sessionTrust.bind(projectTrust),
      prepare: projectTrust.prepare.bind(projectTrust),
      // A listed session's folder is checked against the roots before respawn or message runs in it.
      allowedRoots: config.allowedRoots,
      // `getCard` refuses a card that does not exist, with the not_found the app knows.
      card: (cardId) => {
        const card = board.getCard(cardId);
        const prompt = [card.title, card.description].filter(Boolean).join("\n\n");
        return { cwd: board.getProject(card.projectId).path, prompt, name: card.title };
      },
      start: {
        self: daemonCommand(process.execPath, Bun.main),
        configFile,
        allowedRoots: config.allowedRoots,
      },
    }),
    trace: new TraceService({ db: store.db, scanner: snippetScanner, telemetry: telemetryStore }),
    summary: new SummaryService({ db: store.db, scanner: snippetScanner }),
    webhook: new WebhookSender({ log: logger.log.bind(logger) }),
    telemetryOptIn: new TelemetryOptIn({ configFile, settingsPath: claudeSettingsPath }),
    budgets,
    quotaHistory,
    changes,
    sessionCommits,
    sessionPrs,
    review: new ReviewComments({ db: store.db, changes, manager, board, central }),
    sessionFiles: new SessionFiles({ db: store.db }),
    ssh: sshTargets,
    // Read-only: this host's own ~/.ssh/config, under whatever home the daemon runs with.
    sshHostKeys,
    sshConnect,
    askpass,
    snippets,
    personas: personaStore,
    personaSessions,
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
        home: userHome(env),
        appData: process.env.APPDATA,
        platform: process.platform,
      }),
      scanner: snippetScanner,
      snippets,
    }),
    sshImport: new SshImporter({
      targets: sshTargets,
      configPath: join(userHome(env), ".ssh", "config"),
      home: userHome(env),
      defaultUser: userInfo().username,
    }),
    terminals,
    tasks: new TaskTracker({ dir: join(config.dataDir, "tasks") }),
    // The built-in templates and the files of `<dataDir>/templates` (phase 33).
    templates: () =>
      loadTemplates({ dir: join(config.dataDir, "templates"), builtins: BUILTIN_TEMPLATES }),
    // The host's default mode and lock (phase 33), kept in the config like the other settings.
    ui: { ...config.ui },
    onUiSettings: (ui) => updateConfigFile(configFile, (raw) => ({ ...raw, ui })),
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
    fileLog,
    releases: new ReleaseFeed({ url: RELEASES_URL }),
    resources: await createResources({
      dataDir: config.dataDir,
      sessions: manager.list.bind(manager),
      // With the terminal off there are none to list, and the read must not fail on it (#937).
      terminals: () => (terminals.enabled ? terminals.list() : []),
      pidOf: terminals.pidOf.bind(terminals),
      ...(options.resourcesProc ? { proc: options.resourcesProc } : {}),
    }),
    worktrees: createWorktrees({
      board,
      sessions: manager,
      runs: runManager,
      terminals,
      externals: central.external,
      locks: folderLocks,
    }),
    ...(updates ? { updates } : {}),
    snapshots,
    rewinder,
    forker: new Forker({ runtime, manager, rewinder, preparePersonas: prepare }),
    mcp: new McpConfig(),
    agentcfg,
    // Phase 26: the project's auto memory; its writes are recorded by name and hash only.
    // Phase 26: Claude Code's plugins through its own CLI; pins and decisions sit by the data.
    plugins: new Plugins({
      cli: claudeCli({
        executable: () => claudePath ?? whichOnPath("claude"),
      }),
      pins: filePins(join(config.dataDir, "plugin-pins.json")),
      record: pluginDecisionLog(join(config.dataDir, "plugin-decisions.jsonl")),
    }),
    memory: new ProjectMemory({
      record: decisionLog(join(config.dataDir, "memory-decisions.jsonl")),
    }),
    ...(updater ? { updater } : {}),
    ...(autoUpdater ? { autoUpdate: autoUpdateOf(autoUpdater, config, configFile) } : {}),
    hostName: config.hostName,
    bind: config.bind,
    port: config.port,
    token: config.token,
    allowedRoots: config.allowedRoots,
    allowedNetworks: config.allowedNetworks,
    ...(claude ? { claude } : {}),
    ...(account ? { account } : {}),
    ...(options.onShutdown ? { onShutdown: options.onShutdown } : {}),
    terminal: await terminalInfo(env),
  });

  const wsl =
    config.wsl.length > 0
      ? new WslSupervisor(config.wsl, {
          logDir: join(config.dataDir, "logs"),
          ...(options.wslCommand ? { command: options.wslCommand } : {}),
        })
      : null;
  await wsl?.start();

  // `pair --rotate` runs in another process: follow the token in the config file.
  const onConfigChange = async () => {
    const token = await readToken(configFile);
    if (token) {
      currentToken = token;
      server.setToken(token);
    }
  };
  watchFile(configFile, { interval: options.configWatchMs ?? 2000 }, onConfigChange);

  // `boot`: milliseconds since the process started, so a slow start shows in a CI log (#347).
  logger.log(
    `flightdeckd ${DAEMON_VERSION} listening on ${server.url} (runtime=${runtimeKind}, boot ${Math.round(performance.now())} ms)`,
  );
  boardLoop.start();
  if (config.allowedRoots.length === 0) {
    logger.error(
      'warning: allowedRoots is empty; no session can be created (run "flightdeckd setup")',
    );
  }

  let stopped: Promise<void> | null = null;
  return {
    url: server.url,
    runtime,
    logger,
    stop: () => {
      stopped ??= (async () => {
        unwatchFile(configFile, onConfigChange);
        // First: whatever stops slowly after must not keep the computer awake meanwhile.
        keepAwake.stop();
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
        prWatch.stop();
        for (const unwatch of unwatchRunEnv) unwatch();
        boardLoop.stop();
        board.stop();
        terminals.stop();
        await central.stop();
        await telemetry.stop();
        maintenance.stop();
        sleeper.stop();
        updates?.stop();
        autoUpdater?.stop();
        await manager.shutdown();
        await server.stop();
        // Issue #100: no package of a transcript outlives the daemon.
        await teleport.stop();
        await teleportInbox.stop();
        history.stop();
        await usageIndex.stop();
        budgets.stop();
        quota.stop();
        store.close();
        await lock.release();
        // The last lines (shutting down…) reach the file before the process can exit.
        await fileLog.flush();
      })();
      return stopped;
    },
  };
}

function configPath(args: CliArgs): string {
  return resolve(expandHome(args.config ?? defaultConfigPath()));
}

/** Current token in the config file, or `null` while it is unreadable or invalid. */
async function readToken(file: string): Promise<string | null> {
  try {
    return (await loadConfig(file)).token;
  } catch {
    return null;
  }
}

/** `flightdeckd pair`: prints the pairing link and its QR code. */
async function runPair(args: CliArgs, deps: CliDeps): Promise<void> {
  const file = configPath(args);
  if (args.rotate) await rotateToken(file);
  const config = await loadConfig(file);
  const tailscale = await tailscaleIp(deps.exec ?? spawnExec);
  const address = pairingAddress(config.bind, tailscale);
  const link = formatPairingLink({
    address,
    port: config.port,
    name: config.hostName,
    token: config.token,
  });
  deps.log.log(link);
  deps.log.log(await renderQr(link));
  if (tailscale && loopbackOnly(config.bind)) {
    deps.log.error(
      `the daemon listens only on ${config.bind}: another machine cannot use the link above. To pair over Tailscale (${tailscale}), run "flightdeckd setup" and accept the Tailscale question.`,
    );
  }
}

/** The command managed sessions run for the Flightdeck MCP server, and whether its program is still there. */
async function mcpReachable(self: string[]): Promise<{ command: string; exists: boolean }> {
  const command = self[0] ?? "";
  return { command, exists: (await stat(command).catch(() => null))?.isFile() === true };
}

/** The text of a file, or null when it is not there. */
const readTextOrNull = (path: string) =>
  Bun.file(path)
    .text()
    .catch(() => null);

/** `flightdeckd doctor`: what a first run needs, with the fix for each failure. Exit 1 on a failure. */
async function runDoctorCommand(args: CliArgs, deps: CliDeps): Promise<number> {
  const file = configPath(args);
  const ctx = (deps.serviceContext ?? osServiceContext)(false);
  const settings = claudeSettingsPath();
  const self = deps.selfCommand ?? daemonCommand(process.execPath, Bun.main);
  let config: Config | null = null;
  const load = async () => {
    config ??= await loadConfig(file);
    return config;
  };
  const report = await runDoctor({
    config: load,
    isDirectory: async (path) => (await stat(path).catch(() => null))?.isDirectory() === true,
    serviceInstalled: async () => (await serviceCommand(ctx)) !== null,
    healthy: async () => waitHealthy(healthUrl(await load()), 1_000, 250),
    refused: async () => refusedAddress(healthUrl(await load()), 1_000),
    tailscaleIp: () => tailscaleIp(deps.exec ?? spawnExec),
    hooks: async () => hooksStatus(settings, hookTarget(await load(), self)),
    claudePath: () => whichOnPath("claude"),
    mcp: () => mcpReachable(self),
    opencode: async () => openCodeState(await load(), process.env),

    linger: () => lingerState(ctx),
    templateProblems: async () =>
      (
        await loadTemplates({
          dir: join((await load()).dataDir, "templates"),
          builtins: BUILTIN_TEMPLATES,
        })
      ).problems,
  });
  for (const item of report.checks) {
    deps.log.log(`${item.status.toUpperCase().padEnd(4)} ${item.name.padEnd(16)} ${item.detail}`);
    if (item.fix) deps.log.log(`     -> ${item.fix}`);
  }
  // What the host needs and does without, grouped like the app's Dependencies section.
  const found = await checkDeps(
    deps.depsEnv ?? {
      platform: process.platform,
      // Like the running daemon: the claude that `flightdeckd setup` wrote into the config wins.
      which: async (name) => {
        const cfg = await load();
        const configured =
          name === "claude" ? (cfg.claude?.executablePath ?? cfg.claudePath) : undefined;
        if (!configured) return whichOnPath(name);
        return (await Bun.file(configured).exists()) ? configured : null;
      },
      version: (path) => probeVersion([path, "--version"]),
      allowedRoots: (await load()).allowedRoots,
      serviceInstalled: async () => (await serviceCommand(ctx)) !== null,
      linger: () => lingerState(ctx),
      // The terminal does not ask the Claude account: the card in the app does.
      account: async () => null,
      hooks: async () => hooksStatus(settings, hookTarget(await load(), self)),
    },
  );
  for (const line of formatDeps(found, process.platform)) deps.log.log(line);
  return doctorExitCode(report.ok, found);
}

/** `flightdeckd setup`: the guided first run (folders, service started now, pair link). */
async function runSetupCommand(args: CliArgs, deps: CliDeps): Promise<void> {
  const file = configPath(args);
  const ctxOf = deps.serviceContext ?? osServiceContext;
  const base = ctxOf(false);
  const stable = stableBinPath(base.home, base.platform);
  let command = base.command;
  const prompt = createPrompt(
    linesOf(deps.stdin ?? Bun.stdin.stream()),
    deps.stdout ?? process.stdout.write.bind(process.stdout),
  );
  const install = (): CliArgs => ({ command: "service", action: "install", config: file });
  await runSetup(
    {
      ...prompt,
      log: deps.log,
      configFile: file,
      home: base.home,
      wsl: detectWsl({ env: deps.env, procVersion: () => readProcVersion() }),
      // The folders it checks are this host's, whatever the service context says it manages.
      platform: process.platform,
      isDirectory: async (path) => (await stat(path).catch(() => null))?.isDirectory() === true,
      tailscaleIp: () => tailscaleIp(deps.exec ?? spawnExec),
      installBinary: async () => {
        const self = deps.selfCommand ?? daemonCommand(process.execPath, Bun.main);
        const placed = await installStableBinary(self, stable, base.platform);
        if (placed === "source") return false;
        command = [stable];
        let running = DAEMON_VERSION;
        if (placed === "kept") {
          const probe = deps.binaryVersion ?? ((bin: string) => binaryVersion(bin, 10_000));
          const result = await reconcileStableBinary({
            self: self[0] as string,
            stable,
            selfVersion: DAEMON_VERSION,
            stableVersion: () => probe(stable),
            stopService: async () => {
              if ((await stopInstalledDaemon(install(), ctxOf(false), deps)) === false) {
                throw new Error(
                  `the daemon of the service still runs ${stable}: stop it and run setup again`,
                );
              }
            },
          });
          const was = result.stableVersion ?? "unknown version";
          if (result.outcome === "replaced") {
            deps.log.log(
              `replaced ${stable} (${was}) with ${DAEMON_VERSION}; the old one is at ${stable}.old`,
            );
          } else if (result.outcome === "same") {
            deps.log.log(`${stable} is already version ${DAEMON_VERSION} and stays`);
          } else {
            running = result.stableVersion as string;
            deps.log.log(
              `${stable} is version ${running}, newer than this download (${DAEMON_VERSION}), and stays`,
            );
          }
        } else if (placed === "copied") {
          deps.log.log(`flightdeckd ${DAEMON_VERSION} copied to ${stable}`);
        }
        deps.log.log(`The service will run ${stable} (flightdeckd ${running})`);
        return true;
      },
      addToPath: async () => {
        const env = { ...base, readFile: readTextOrNull };
        for (const line of await addToUserPath(env, binDir(base))) deps.log.log(line);
      },
      linger: () => lingerState(base),
      installService: async () => {
        const ctx = ctxOf(false);
        if ((await serviceCommand(ctx)) !== null) await stopInstalledDaemon(install(), ctx, deps);
        await runService(install(), {
          ...deps,
          serviceContext: (dryRun) => ({ ...ctxOf(dryRun), command }),
        });
      },
      installHooks: () => runHooks({ command: "hooks", action: "install", config: file }, deps),
      pair: () => runPair({ command: "pair", config: file }, deps),
    },
    { ...(args.yes ? { yes: true } : {}), ...(args.folders ? { folders: args.folders } : {}) },
  );
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
  return stopServiceDaemon(
    stop,
    await serviceConfig(args, installed),
    installed.command[0] as string,
  );
}

/** `service stop`: the daemon goes, the task or unit stays installed. */
async function stopService(args: CliArgs, ctx: ServiceContext, deps: CliDeps): Promise<void> {
  const stopped = await stopInstalledDaemon(args, ctx, deps);
  if (stopped === null) throw new Error("no service installed");
  if (!stopped) throw new Error("the service's daemon did not stop: stop it by hand");
  deps.log.log("the service's daemon stopped (the service stays installed)");
}

/** `service start`: runs the task or unit and waits for `/health` of the service's config. */
async function startInstalledService(
  args: CliArgs,
  ctx: ServiceContext,
  deps: CliDeps,
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

type ServiceContextOf = ReturnType<NonNullable<CliDeps["serviceContext"]>>;

async function uninstallInstalledService(
  args: CliArgs,
  ctx: ServiceContextOf,
  deps: CliDeps,
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

/**
 * #1200: `service.install` for a daemon run as its stable binary (the file a service starts);
 * undefined for any other, so a daemon run from source (the demo, the journeys) never offers it.
 * The service gets `--config` only when this daemon was started with one, as an absolute path.
 */
function appServiceInstall(
  config: string | null,
  configFile: string,
  ctxOf: (dryRun: boolean) => ServiceContext,
  self: string[],
): ((confirm: boolean) => Promise<ServiceInstallResult>) | undefined {
  const base = ctxOf(false);
  if (!appCanInstallService(self, stableBinPath(base.home, base.platform), base.platform)) {
    return undefined;
  }
  return (confirm) =>
    installServiceFromApp(
      {
        ctx: { ...base, command: self },
        config: config ? resolve(config) : null,
        recordClaude: async (executablePath) => {
          await updateConfigFile(configFile, (raw) => ({
            ...raw,
            claude: { ...(raw.claude as object), executablePath },
          }));
        },
      },
      confirm,
    );
}

/** Writes the `claude` the service found into the config (or says it would, in a dry run). */
async function recordServiceClaude(
  file: string,
  claude: ReturnType<typeof resolveServiceClaude>,
  ctx: ServiceContextOf,
  deps: CliDeps,
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

async function runService(args: CliArgs, deps: CliDeps): Promise<void> {
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

/**
 * `flightdeckd history reindex`: drops the transcript index and builds it again. Takes the
 * daemon's lock, so it refuses (exit 3) while a daemon uses the same `dataDir`.
 */
async function runReindex(args: CliArgs, deps: CliDeps): Promise<void> {
  const config = await loadConfig(configPath(args));
  const lock = await acquireLock(config.dataDir);
  if (!lock) {
    throw new AlreadyRunningError(config.dataDir, "stop the daemon before rebuilding the index");
  }
  const store = await EventStore.open(join(config.dataDir, "flightdeck.db"));
  try {
    const history = new HistoryIndexer({
      db: store.db,
      roots: config.history.roots,
      excludeCwds: historyExcludes(config),
    });
    const { sessions, messages } = await history.rebuild();
    deps.log.log(`history rebuilt: ${sessions} sessions, ${messages} messages`);
  } finally {
    store.close();
    await lock.release();
  }
}

const HOOKS_LABELS: Record<HooksStatus, string> = {
  installed: "installed",
  absent: "absent",
  outdated: "outdated (run hooks install again)",
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
async function runHooks(args: CliArgs, deps: CliDeps): Promise<void> {
  const file = configPath(args);
  let config = await loadConfig(file);
  const settings = claudeSettingsPath();
  const self = deps.selfCommand ?? daemonCommand(process.execPath, Bun.main);
  if (args.action === "status") {
    deps.log.log(`hooks: ${HOOKS_LABELS[await hooksStatus(settings, hookTarget(config, self))]}`);
    return;
  }
  if (args.action === "uninstall") {
    const removed = await uninstallHooks(settings);
    deps.log.log(removed ? `hooks removed from ${settings}` : "no Flightdeck hook installed");
    return;
  }
  if (config.hooks.port === 0) {
    throw new Error(
      "hooks.port 0 does not work for installed hooks: set a fixed port in the config",
    );
  }
  if (!config.hooks.token) {
    const token = generateToken();
    await updateConfigFile(file, (raw) => ({ ...raw, hooks: { ...(raw.hooks as object), token } }));
    config = await loadConfig(file);
  }
  await installHooks(settings, hookTarget(config, self));
  deps.log.log(`hooks installed in ${settings} (previous copy in settings.json.flightdeck-backup)`);
}

const TELEMETRY_LABELS: Record<TelemetryStatus, string> = {
  installed: "installed",
  absent: "absent",
  outdated: "outdated (run telemetry install again)",
  conflict: "not installed: settings.json has an exporter of your own",
};

/** `flightdeckd telemetry install|uninstall|status`: Claude Code's exporters into this daemon (phase 23). */
async function runTelemetry(args: CliArgs, deps: CliDeps): Promise<void> {
  const optIn = new TelemetryOptIn({
    configFile: configPath(args),
    settingsPath: claudeSettingsPath,
  });
  if (args.action === "status") {
    deps.log.log(`telemetry: ${TELEMETRY_LABELS[(await optIn.status()).status]}`);
    return;
  }
  const had = (await optIn.status()).status;
  const result =
    args.action === "uninstall" ? await optIn.uninstall(true) : await optIn.install(true);
  const removed =
    had === "installed" || had === "outdated"
      ? `telemetry removed from ${result.settingsPath}`
      : "no Flightdeck telemetry installed";
  deps.log.log(
    args.action === "uninstall"
      ? `${removed}; the receiver has a new token`
      : `telemetry installed in ${result.settingsPath} (previous copy in settings.json.flightdeck-telemetry-backup)`,
  );
}

/** `flightdeckd backup [--out <file>]`: a backup now, with the daemon running or not. */
async function runBackup(args: CliArgs, deps: CliDeps): Promise<void> {
  const config = await loadConfig(configPath(args));
  const store = await EventStore.open(join(config.dataDir, "flightdeck.db"));
  try {
    const info = await new Maintenance({
      db: store.db,
      dataDir: config.dataDir,
      retention: config.retention,
      backup: config.backup,
      ...(deps.now ? { now: deps.now } : {}),
    }).backupNow(args.out);
    deps.log.log(`backup created: ${info.path} (${info.bytes} bytes)`);
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

async function runUpdateCommand(args: CliArgs, deps: CliDeps): Promise<number> {
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

/** `flightdeckd restore <file>`: only with the daemon stopped. */
async function runRestore(args: CliArgs, deps: CliDeps): Promise<void> {
  if (!args.file) throw new Error("restore needs the file: flightdeckd restore <file>");
  const config = await loadConfig(configPath(args));
  const { beforeRestore } = await restoreBackup({ file: args.file, dataDir: config.dataDir });
  deps.log.log(`database restored from ${args.file}; the previous one stayed at ${beforeRestore}`);
}

/** `flightdeckd db prune [--dry-run]`: the retention policy now, with the count per table. */
async function runPrune(args: CliArgs, deps: CliDeps): Promise<void> {
  const config = await loadConfig(configPath(args));
  const store = await EventStore.open(join(config.dataDir, "flightdeck.db"));
  try {
    const maintenance = new Maintenance({
      db: store.db,
      dataDir: config.dataDir,
      retention: config.retention,
      ...(deps.now ? { now: deps.now } : {}),
    });
    const counts = await maintenance.prune(args.dryRun === true);
    deps.log.log(args.dryRun ? "dry run of the cleanup (nothing was deleted):" : "cleanup done:");
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
  /** The machine the dependency check probes, in `doctor`; the real one when absent (tests give theirs). */
  depsEnv?: DepsEnv;
  log: Logger;
  exit(code: number): void;
  onSignal(signal: "SIGINT" | "SIGTERM", handler: () => Promise<void>): void;
  serviceContext?: (dryRun: boolean) => ServiceContext;
  /** Runs external commands (`tailscale ip -4`); injected in tests. */
  exec?: Exec;
  /** This daemon's own command line, as hooks call it back; derived from the process if absent. */
  selfCommand?: string[];
  /** What `<bin> --version` says; the real one runs the binary. Injected in tests. */
  binaryVersion?: (bin: string) => Promise<string | null>;
  /** Standard input (`hook session-start` reads the hook's JSON); the process's if absent. */
  stdin?: ReadableStream<Uint8Array>;
  /** Where `setup` writes its questions; the process's stdout if absent. */
  stdout?: (text: string) => void;
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
  /** The platform `flightdeckd claude` launches claude on; the process's when absent. Injected in tests. */
  platform?: NodeJS.Platform;
}

/** A command that is not the daemon: what it prints and does, and the exit code (null: it stays open). */
type CommandRun = (args: CliArgs, deps: CliDeps) => Promise<number | null>;

/** Runs a one-shot step and exits 0. */
const done =
  (step: (args: CliArgs, deps: CliDeps) => Promise<unknown>): CommandRun =>
  async (args, deps) => {
    await step(args, deps);
    return 0;
  };

/** Prints what a client command returned, as JSON, and exits 0. */
const printed = (deps: CliDeps, result: unknown): Promise<number> =>
  settled(() => {
    deps.log.log(JSON.stringify(result, null, 2));
    return 0;
  });

const COMMANDS: Partial<Record<CliArgs["command"], CommandRun>> = {
  backup: done(runBackup),
  restore: done(runRestore),
  update: (args, deps) => runUpdateCommand(args, deps),
  db: done(runPrune),
  version: (_args, deps) =>
    settled(() => {
      deps.log.log(`flightdeckd ${DAEMON_VERSION} (protocolo ${PROTOCOL_VERSION})`);
      return 0;
    }),
  hook: async (args, deps) => {
    await sendSessionStart({
      url: args.url ?? "",
      token: args.token ?? "",
      input: await new Response(deps.stdin ?? Bun.stdin.stream()).text(),
      env: deps.env,
      timeoutMs: deps.hookConnectTimeoutMs ?? HOOK_CONNECT_TIMEOUT_MS,
    });
    return 0;
  },
  claude: async (args, deps) => {
    // Its own arguments all go to claude, so the config comes from the environment.
    const file = resolve(expandHome(deps.env.FLIGHTDECK_CONFIG ?? defaultConfigPath()));
    return runClaude({
      args: args.claudeArgs ?? [],
      cwd: deps.cwd ?? process.cwd(),
      config: await loadConfig(file),
      env: deps.env,
      self: deps.selfCommand ?? daemonCommand(process.execPath, Bun.main),
      log: deps.log,
      timeoutMs: deps.hookConnectTimeoutMs ?? HOOK_CONNECT_TIMEOUT_MS,
      ...(deps.platform ? { platform: deps.platform } : {}),
      ...(deps.exec ? { exec: deps.exec } : {}),
    });
  },
  askpass: async (args, deps) => {
    // ssh runs this with only the prompt, so the config comes from the environment.
    const file = resolve(expandHome(deps.env.FLIGHTDECK_CONFIG ?? defaultConfigPath()));
    const secret = await runAskpass({
      configFile: file,
      ticket: deps.env.FLIGHTDECK_ASKPASS_TICKET,
      prompt: args.askpassPrompt ?? "",
    });
    deps.log.log(secret);
    return 0;
  },
  channel: async (args, deps) => {
    const channel = await startChannel({
      launchId: args.launch ?? "",
      url: args.url ?? "",
      token: args.token ?? "",
      transport: deps.channelTransport ?? new StdioServerTransport(),
    }).catch((error: Error) => {
      throw new Error(`could not open the Flightdeck channel: ${error.message}`);
    });
    void channel.closed.then(() => deps.exit(0));
    return null;
  },
  statusline: async (args, deps) => {
    // Never creates the config: a statusline runs where there may be no daemon at all.
    const line = await runStatusline({
      configFile: configPath(args),
      stdin: deps.stdin ?? Bun.stdin.stream(),
    });
    deps.log.log(line);
    return 0;
  },
  mcp: async (args, deps) => {
    const config = await loadConfig(configPath(args));
    const mcp = await startMcp({
      url: daemonUrl(config),
      token: config.token,
      transport: deps.mcpTransport ?? new StdioServerTransport(),
      cwd: deps.cwd ?? process.cwd(),
      identity: identityOf(deps.env),
    });
    void mcp.closed.then(() => deps.exit(0));
    return null;
  },
  message: async (args, deps) => {
    const config = await loadConfig(configPath(args));
    return printed(
      deps,
      await runMessageCli(
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
      ),
    );
  },
  action: async (args, deps) => {
    const config = await loadConfig(configPath(args));
    return printed(
      deps,
      await runActionCli(
        {
          action: args.action as "list" | "run",
          project: args.project,
          name: args.actionName,
          params: args.params,
        },
        config,
      ),
    );
  },
  snippet: async (args, deps) => {
    const config = await loadConfig(configPath(args));
    return printed(
      deps,
      await runSnippetCli(
        {
          action: args.action as "list" | "get",
          name: args.snippetName,
          projectPath: args.projectPath,
          query: args.query,
        },
        config,
      ),
    );
  },
  hooks: done(runHooks),
  telemetry: done(runTelemetry),
  history: done(runReindex),
  doctor: (args, deps) => runDoctorCommand(args, deps),
  setup: done(runSetupCommand),
  pair: done(runPair),
  service: done(runService),
};

/** CLI entry: starts the daemon and wires SIGINT/SIGTERM to a clean stop. */
export async function runCli(argv: readonly string[], deps: CliDeps): Promise<Daemon | null> {
  try {
    const args = parseArgs(argv);
    const run = COMMANDS[args.command];
    if (run) {
      const code = await run(args, deps);
      if (code !== null) deps.exit(code);
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
