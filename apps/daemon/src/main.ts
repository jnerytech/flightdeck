import { createHash, randomUUID } from "node:crypto";
import { unwatchFile, watchFile } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_MODELS, PROTOCOL_VERSION, type ServiceInstallResult } from "@flightdeck/protocol";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Account } from "./account/account.ts";
import { demoAccountReaders } from "./account/demo.ts";
import { accountReaders } from "./account/readers.ts";
import { Actions } from "./actions/actions.ts";
import { runActionCli, runSnippetCli } from "./actions/cli.ts";
import { activitySince } from "./activity/since.ts";
import { AgentConfig } from "./agentcfg/files.ts";
import { McpConfig } from "./agentcfg/mcp.ts";
import { assistantService } from "./assistant/factory.ts";
import { assistantDir } from "./assistant/paths.ts";
import { Automations } from "./automations/automations.ts";
import { BgService } from "./bg/service.ts";
import { Board } from "./board/board.ts";
import { CheckLoopSwitch, cardMode } from "./board/check-loop.ts";
import { HostPause } from "./board/host-pause.ts";
import { readSpecText } from "./board/spec.ts";
import { templateRootOf } from "./board/spec-template.ts";
import { BoardSync } from "./boardsync/engine.ts";
import { GithubBoards } from "./boardsync/github.ts";
import { BoardSyncLoop } from "./boardsync/loop.ts";
import { BoardSyncService } from "./boardsync/service.ts";
import { BoardSyncStore } from "./boardsync/store.ts";
import { runCardCli } from "./card-cli.ts";
import { Central, messageExternal } from "./central/central.ts";
import { startChannel } from "./central/channel.ts";
import { sendSessionStart } from "./central/hook-command.ts";
import { type AsyncGitRunner, ProjectKeys } from "./central/project-key.ts";
import { runClaude } from "./central/wrapper.ts";
import { Forker } from "./checkpoints/fork.ts";
import { Rewinder } from "./checkpoints/rewind.ts";
import { Snapshots } from "./checkpoints/snapshots.ts";
import { claudeVersionProbe } from "./claude-probe.ts";
import { type CliArgs, configPath, parseArgs } from "./cli/args.ts";
import { runHooks, runTelemetry } from "./cli/claude-settings.ts";
import { runReindex } from "./cli/history.ts";
import { runService, runUpdateCommand } from "./cli/host.ts";
import { type MaintenanceCommandDeps, runBackup, runPrune, runRestore } from "./cli/maintenance.ts";
import { runDoctorCommand, runPair, runSetupCommand, type SetupCommandDeps } from "./cli/setup.ts";
import {
  type Config,
  claudeSettingsPath,
  defaultConfigPath,
  expandHome,
  loadConfig,
  RELEASES_URL,
  type RuntimeKind,
  updateConfigFile,
  userHome,
} from "./config.ts";
import { runStatusline } from "./costs/statusline.ts";
import { createCosts } from "./costs/wiring.ts";
import { createHostChecks, type HostCheckOptions } from "./deps/wiring.ts";
import { spawnExec } from "./exec.ts";
import { listAlerts } from "./github/alerts.ts";
import { runGh, runGhIn } from "./github/gh.ts";
import { GithubService } from "./github/service.ts";
import { createHarness } from "./harness/wiring.ts";
import { HistoryIndexer } from "./history/indexer.ts";
import { Issues } from "./issues/issues.ts";
import { createKnowledgeDoc } from "./knowledge/create.ts";
import { listKnowledge } from "./knowledge/list.ts";
import { knowledgeFeedFor } from "./knowledge/serve.ts";
import { setKnowledgeStatus } from "./knowledge/status.ts";
import { knowledgeSwitchFor } from "./knowledge/switch.ts";
import { AlreadyRunningError, acquireLock, EXIT_ALREADY_RUNNING } from "./lock.ts";
import type { Logger } from "./logger.ts";
import { FileLog } from "./logs/file-log.ts";
import { createLogScanner } from "./logs/scanner.ts";
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
import { AutoApprover, historyExcludes } from "./permissions/auto-approve.ts";
import { RiskClassifier } from "./permissions/risk.ts";
import { credential } from "./permissions/sensitive-paths.ts";
import { OpenSessionPersonas } from "./personas/open-session.ts";
import { packPersonas } from "./personas/pack.ts";
import { type Prepare, preparePersonas } from "./personas/prepare.ts";
import { agentPublisher } from "./personas/publish.ts";
import { Personas } from "./personas/store.ts";
import { claudeCli, filePins, Plugins, pluginDecisionLog } from "./plugins/plugins.ts";
import type { PowerContext } from "./power/keep-awake.ts";
import { createKeepAwake } from "./power/wiring.ts";
import { present } from "./present.ts";
import { UsageLedger } from "./quota/usage.ts";
import { createQuota } from "./quota/wiring.ts";
import { ReleaseFeed } from "./releases/releases.ts";
import type { ProcReader } from "./resources/resources.ts";
import { createMemoryGate, createResources, type MemoryGateDeps } from "./resources/wiring.ts";
import { CardReviews, reviewHold } from "./review/card-review.ts";
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
import { type CreatedOpenCode, createOpenCode } from "./runtime/opencode-wiring.ts";
import type { AgentRuntime } from "./runtime/types.ts";
import { startServer } from "./server.ts";
import { daemonCommand, type ServiceContext } from "./service.ts";
import { appCanInstallService, installServiceFromApp } from "./service-from-app.ts";
import { osServiceContext } from "./service-os.ts";
import { SessionManager } from "./sessions/session-manager.ts";
import { IdleSleeper } from "./sessions/sleeper.ts";
import { StallWatcher } from "./sessions/stall.ts";
import { settled } from "./settled.ts";
import { defaultHistorySources, HistoryImporter } from "./snippets/history.ts";
import { SecretScanner } from "./snippets/model.ts";
import { Snippets } from "./snippets/store.ts";
import { SnippetUse } from "./snippets/use.ts";
import { runAskpass } from "./ssh/askpass.ts";
import { createSsh } from "./ssh/wiring.ts";
import { EventStore } from "./store/event-store.ts";
import { SummaryService } from "./summary/service.ts";
import { Teams } from "./teams/teams.ts";
import { createTelemetry } from "./telemetry/wiring.ts";
import { teleportImportDeps } from "./teleport/import.ts";
import { TeleportPackages, teleportDeps } from "./teleport/package.ts";
import { TeleportInbox } from "./teleport/receive.ts";
import { BUILTIN_TEMPLATES } from "./templates/builtin.ts";
import { loadTemplates } from "./templates/files.ts";
import { TaskTracker } from "./templates/tasks.ts";
import { createTerminals, type TerminalsDeps } from "./terminal/wiring.ts";
import { TraceService } from "./trace/service.ts";
import { inspectProject } from "./trust/inspect.ts";
import { ProjectTrust } from "./trust/project-trust.ts";
import { ulid } from "./ulid.ts";
import { stableBinPath } from "./update.ts";
import { autoUpdateOf } from "./updates/auto.ts";
import { createUpdates } from "./updates/wiring.ts";
import { VaultRules } from "./vault/rules-store.ts";
import { Vault } from "./vault/vault.ts";
import { DAEMON_VERSION } from "./version.ts";
import { PrFixer } from "./watch/fix.ts";
import { PrWatch } from "./watch/service.ts";
import { Traces } from "./watch/trace.ts";
import { PrWatcher, readWatchSettings } from "./watch/watch.ts";
import { WebhookSender } from "./webhook/sender.ts";
import { whichOnPath } from "./which.ts";
import { boundedCheckRunner } from "./workflows/check-runner.ts";
import { FolderLocks } from "./worktrees/locks.ts";
import { createWorktrees } from "./worktrees/wiring.ts";
import { type WslItem, WslSupervisor } from "./wsl.ts";

export { type CliArgs, parseArgs, type ServiceAction } from "./cli/args.ts";

/** `hook session-start` gives up on the receptor after this long (the hook's own limit is 5 s). */
export const HOOK_CONNECT_TIMEOUT_MS = 1_000;

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

/** The supervisor of the WSL distributions the config lists, if any. */
function createWsl(config: Config, options: { wslCommand?: (item: WslItem) => string[] }) {
  if (config.wsl.length === 0) return null;
  return new WslSupervisor(config.wsl, {
    logDir: join(config.dataDir, "logs"),
    ...present({ command: options.wslCommand }),
  });
}

/** Without an allowed root no session can be created: the log says so at the start. */
function warnIfNoRoots(config: Config, logger: Logger): void {
  if (config.allowedRoots.length > 0) return;
  logger.error(
    'warning: allowedRoots is empty; no session can be created (run "flightdeckd setup")',
  );
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
    pty?: TerminalsDeps["pty"];
    /** Where `resources.get` reads processes from; the real /proc on Linux when absent (tests inject a fake). */
    resourcesProc?: ProcReader;
    /** The host's memory for the hold on new cards (#1343); the OS's when absent (tests inject one). */
    memoryReading?: MemoryGateDeps["reading"];
    /** How the project key asks git; the process itself when absent (tests hold it). */
    projectGit?: AsyncGitRunner;
    /** The command line of this daemon, for `service.install` (#1200); its own when absent. */
    serviceSelf?: string[];
    /** Whether a port is free, for the cards' blocks; the real loopback probe when absent. */
    portProbe?: (port: number) => Promise<boolean>;
    /** What keeps the computer awake (issue #163); the machine's own when absent. */
    powerContext?: PowerContext;
  } & HostCheckOptions = {},
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
  // This daemon's own command line, as the sessions' MCP server, the hooks and the terminals call it back.
  const selfCommand = daemonCommand(process.execPath, Bun.main);
  const mcpServer = flightdeckMcpServer(selfCommand, configFile);
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
  const { quota, quotaHistory, onQuota, quotaPause } = createQuota({
    db: store.db,
    config,
    configFile,
  });
  // Issue #1343: new cards wait while memory is at or above resources.pauseAt. FLIGHTDECK_SERVICE_GUARD
  // is set only by the test preload, never in production: under it nothing of the real machine is
  // read (a busy runner would hold every board test), so the hold stays open unless a test injects one.
  const { memoryGate, memoryPause } = createMemoryGate({
    config,
    configFile,
    reading:
      options.memoryReading ?? (process.env.FLIGHTDECK_SERVICE_GUARD ? () => null : undefined),
  });
  // Issue #1404: the person's pause of new card runs, kept in the config.
  const hostPause = new HostPause(config.pauseNewRuns);
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
  const { keepAwake, keepAwakeSwitch } = createKeepAwake({
    powerContext: options.powerContext,
    config,
    configFile,
  });

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
    ...present({ opencode: opencode.runtime }),
    onQuota,
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
    ...present({ scanIntervalMs: config.history.scanIntervalMs || undefined }),
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
  const { costs, usageIndex, budgets } = createCosts({
    db: store.db,
    config,
    readPricing: async () => (await loadConfig(configFile)).pricing,
    excludeCwds: historyExcludes(config),
    projectKey: (cwd) => keys.known(cwd),
    warmKeys: (cwds) => Promise.all(cwds.map((cwd) => keys.resolve(cwd))),
    quota,
    log: (m) => logger.log(m),
    history,
  });
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
    memory: memoryGate,
    pause: hostPause,
    // Issue #1361: the check loop, on the watch's checks (read when a turn ends, so the watcher made
    // below is ready by then) and the project's trust, through the bounded runner.
    checkLoop: {
      // From the database alone: the board reads them while it starts, before the watcher exists.
      settings: (projectId) => readWatchSettings(store.db, projectId),
      isTrusted: (path) => projectTrust.isTrusted(path),
      runner: boundedCheckRunner(),
    },
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
    ...present({ prPollIntervalMs: config.board.prPollIntervalMs || undefined }),
    // Changed from the app: kept in the config file, like the rest of the host settings.
    onSettingsChange: ({ maxParallelRuns }) =>
      updateConfigFile(configFile, (raw) => ({ ...raw, maxParallelRuns })),
  });
  // In the background: the radar reads the worktrees; the project keys get cached for the first card.
  void board.start();
  void board.warmProjectKeys();
  // Real shells behind a PTY, kept across connections; none outlives the daemon.
  const { terminals, onTerminalSettings } = createTerminals({
    config,
    configFile,
    folderLocks,
    pty: options.pty,
    self: selfCommand,
    log: (message) => logger.log(message),
  });
  // The diff of every session and card, for the review (phase 11).
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
    checks: boundedCheckRunner(),
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
  const { updates, updater, autoUpdater } = createUpdates(config, {
    idle: () => manager.activeSessionCount() === 0 && board.workflows.activeRuns().length === 0,
    log: logger.log.bind(logger),
  });
  void updates?.start();
  const { telemetryStore, telemetry, telemetryOptIn } = await createTelemetry({
    db: store.db,
    config,
    configFile,
    settingsPath: claudeSettingsPath,
    log: logger,
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
    selfCommand,
    settingsPath: claudeSettingsPath,
  });
  // Phase 15: the SSH destinations, their server keys, the connector and askpass.
  const ssh = await createSsh({
    db: store.db,
    config,
    configFile,
    self: selfCommand,
    terminals,
    exists,
    home: userHome(env),
    platform: process.platform,
    user: userInfo().username,
    sockDir: tmpdir(),
  });
  const snippets = new Snippets({
    db: store.db,
    allowedRoots: config.allowedRoots,
    scanner: snippetScanner,
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
    ssh: ssh.exec,
    sshTags: ssh.tagsOf,
    sshKey: ssh.vaultKeyOf,
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
    ...present({ teamOfCard: teams?.teamOfCard.bind(teams) }),
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
    ...present({ isFree: options.portProbe }),
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
  // A running session that says nothing for N minutes is marked quiet (0: off, no timer then).
  const stall = new StallWatcher({
    host: manager,
    minutes: config.stall.afterMinutes,
    // The demo and the journeys count a "minute" in seconds, so a quiet session does not take a quarter of an hour.
    ...(Number(process.env.FLIGHTDECK_STALL_UNIT_MS) > 0
      ? { unitMs: Number(process.env.FLIGHTDECK_STALL_UNIT_MS) }
      : {}),
  });
  // The wrapper finds the receptor through this file: nothing is served before it is there.
  await central.ready();
  // A session that was open before the restart may be sent a message before anything else looks
  // at its folder: read the git boundaries of every folder first, so the lazy reattach finds them.
  // `prepare` answers every filesystem error itself (a folder it cannot read is a boundary).
  await projectTrust.prepareSessions(manager.list());
  const harness = createHarness({
    runtime,
    quota,
    scanner: snippetScanner,
    cwd: assistantDir(config.dataDir),
    config,
  });
  // Phase 40: the AI assistant on this host's claude (the fake runtime answers in the demo).
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
  // Issue #1439: the cards' second-opinion review, on the runtime's tool-less one-shot call.
  const reviewComments = new ReviewComments({ db: store.db, changes, manager, board, central });
  const complete = runtime.complete?.bind(runtime);
  const reviewScanner = new SecretScanner(() => heldValues());
  const cardReviews = complete
    ? new CardReviews({
        db: store.db,
        card: (id) => {
          const card = board.getCard(id);
          return {
            id: card.id,
            projectId: card.projectId,
            title: card.title,
            description: card.description,
            worktreePath: card.worktreePath,
            running:
              card.queued ||
              ["starting", "running", "awaiting_permission"].includes(card.sessionStatus ?? ""),
          };
        },
        diff: (id) => board.diff(id),
        // The spec file of the card, with readSpec's checks (its real place inside the worktree, no
        // link on the way, no hard link), never a credential file, at most 20 KB.
        spec: async (id) => {
          const { specPath, worktreePath } = board.getCard(id);
          if (!specPath || !worktreePath || credential(specPath)) return undefined;
          return (await readSpecText(worktreePath, specPath, 20_000)) ?? undefined;
        },
        hold: (projectId) =>
          reviewHold({
            paused: hostPause.blocked() !== null,
            quota: quota.blocked() !== null,
            memory: memoryGate.blocked() !== null,
            budget: board.budgetHeld(projectId),
          }),
        complete,
        comments: reviewComments,
        redact: (text) => reviewScanner.redact(text, false),
        persona: (language) => packPersonas(language).find((p) => p.id === "revisor")?.body ?? "",
        model: DEFAULT_MODELS.host.careful,
        record: (cardId, worktree, tokens) =>
          usageIndex.record({
            at: new Date().toISOString(),
            model: tokens.model,
            tokens,
            projectPath: worktree,
            messageId: `card-review-${cardId}-${ulid()}`,
            origin: "card",
          }),
      })
    : undefined;
  const hostChecks = createHostChecks({
    config,
    env,
    opencode,
    claude,
    claudePath,
    account: async () => (await account?.get())?.status ?? null,
    options,
  });
  const server = startServer({
    ...(options.projectGit ? { projectGit: options.projectGit } : {}),
    manager,
    opencode: {
      info: () => opencode.info,
      models: () => (opencode.models as NonNullable<CreatedOpenCode["models"]>)(),
    },
    ...present({ assistant }),
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
    ...present({ rootsPlatform: options.rootsPlatform }),
    bypass: {
      allowed: () => config.allowBypassPermissions,
      set: async (allow) => {
        config.allowBypassPermissions = allow;
        await updateConfigFile(configFile, (raw) => ({ ...raw, allowBypassPermissions: allow }));
      },
    },
    stall: { minutes: () => stall.minutes() },
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
    hostPause: {
      // What still runs, as the auto update's idle check counts it: sessions and workflow runs (a
      // run waiting at a gate has no session but resumes after a restart).
      status: () => ({
        paused: hostPause.paused(),
        running: manager.activeSessionCount() + board.workflows.activeRuns().length,
      }),
      set: async (paused) => {
        // The file first: when it cannot be written the pause stays as it was, for the client and the daemon.
        await updateConfigFile(configFile, (raw) => ({ ...raw, pauseNewRuns: paused }));
        config.pauseNewRuns = paused;
        hostPause.set(paused);
      },
    },
    memoryPause,
    quotaPause,
    keepAwake: keepAwakeSwitch,
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
    ...harness,
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
    // Issue #1344: "While you were away": what happened since a time, from what is stored.
    activity: (since, limit) =>
      activitySince({ db: store.db, quota: () => quota.windows() }, since, limit),
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
      options.serviceSelf ?? selfCommand,
    ),
    ...hostChecks,
    sessionSettings: true,
    messaging,
    names,
    idle,
    teams,
    watch: prWatch,
    // Issue #1361: the check loop's switch, on the watch's checks and the project's trust.
    checkLoop: new CheckLoopSwitch({
      board,
      settings: (projectId) => prWatcher.settings(projectId),
      isTrusted: (path) => projectTrust.isTrusted(path),
      modeOf: (card) => cardMode(card, manager),
    }),
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
        self: selfCommand,
        configFile,
        allowedRoots: config.allowedRoots,
      },
    }),
    trace: new TraceService({ db: store.db, scanner: snippetScanner, telemetry: telemetryStore }),
    summary: new SummaryService({ db: store.db, scanner: snippetScanner }),
    webhook: new WebhookSender({ log: logger.log.bind(logger) }),
    telemetryOptIn,
    budgets,
    quotaHistory,
    changes,
    sessionCommits,
    sessionPrs,
    review: reviewComments,
    ...(cardReviews ? { cardReview: cardReviews } : {}),
    sessionFiles: new SessionFiles({ db: store.db }),
    ...ssh.server,
    snippets,
    personas: personaStore,
    personaSessions,
    snippetUse: new SnippetUse({
      snippets,
      terminals,
      manager,
      onPersonInput: (sessionId) => board.personTurnOfSession(sessionId),
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
    terminals,
    tasks: new TaskTracker({ dir: join(config.dataDir, "tasks") }),
    // The built-in templates and the files of `<dataDir>/templates` (phase 33).
    templates: () =>
      loadTemplates({ dir: join(config.dataDir, "templates"), builtins: BUILTIN_TEMPLATES }),
    // The host's default mode and lock (phase 33), kept in the config like the other settings.
    ui: { ...config.ui },
    onUiSettings: (ui) => updateConfigFile(configFile, (raw) => ({ ...raw, ui })),
    onTerminalSettings,
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
      ...present({ proc: options.resourcesProc }),
    }),
    worktrees: createWorktrees({
      board,
      sessions: manager,
      runs: runManager,
      terminals,
      externals: central.external,
      locks: folderLocks,
    }),
    ...present({ updates }),
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
    ...present({
      updater,
      autoUpdate: autoUpdater && autoUpdateOf(autoUpdater, config, configFile),
    }),
    hostName: config.hostName,
    bind: config.bind,
    port: config.port,
    token: config.token,
    allowedRoots: config.allowedRoots,
    allowedNetworks: config.allowedNetworks,
    ...present({ claude, account, onShutdown: options.onShutdown }),
    terminal: await terminalInfo(env),
  });

  const wsl = createWsl(config, options);
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
  warnIfNoRoots(config, logger);

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
        stall.stop();
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

/** Current token in the config file, or `null` while it is unreadable or invalid. */
async function readToken(file: string): Promise<string | null> {
  try {
    return (await loadConfig(file)).token;
  } catch {
    return null;
  }
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

export interface CliDeps extends SetupCommandDeps, MaintenanceCommandDeps {
  log: Logger;
  exit(code: number): void;
  onSignal(signal: "SIGINT" | "SIGTERM", handler: () => Promise<void>): void;
  /** How long `hook session-start` tries to reach the receptor. */
  hookConnectTimeoutMs?: number;
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
  card: async (args, deps) => {
    // The daemon's token is read from the config file and from nowhere else.
    if (args.token !== undefined)
      throw new Error("the token of this command is read from the config file only: drop --token");
    const config = await loadConfig(configPath(args));
    const result = await runCardCli(
      {
        action: args.action as "list" | "show" | "new" | "start",
        ...(args.project === undefined ? {} : { project: args.project }),
        ...(args.cardId === undefined ? {} : { id: args.cardId }),
        ...(args.cardTitle === undefined ? {} : { title: args.cardTitle }),
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.workflow === undefined ? {} : { workflow: args.workflow }),
        ...(args.json ? { json: true } : {}),
      },
      config,
    );
    return settled(() => {
      for (const line of result.out) deps.log.log(line);
      for (const line of result.err) deps.log.error(`flightdeckd: ${line}`);
      return result.code;
    });
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
