import { randomUUID } from "node:crypto";
import { unwatchFile, watchFile } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { Account } from "./account/account.ts";
import { demoAccountReaders } from "./account/demo.ts";
import { accountReaders } from "./account/readers.ts";
import { createVault } from "./actions/wiring.ts";
import { activitySince } from "./activity/since.ts";
import { AgentConfig } from "./agentcfg/files.ts";
import { McpConfig } from "./agentcfg/mcp.ts";
import { assistantService } from "./assistant/factory.ts";
import { assistantDir } from "./assistant/paths.ts";
import { Automations } from "./automations/automations.ts";
import { createBgService } from "./bg/wiring.ts";
import { readSpecText } from "./board/spec.ts";
import { createBoard, createCheckLoop, createHostPause } from "./board/wiring.ts";
import { createBoardSync } from "./boardsync/wiring.ts";
import { Central, messageExternal } from "./central/central.ts";
import { type AsyncGitRunner, ProjectKeys } from "./central/project-key.ts";
import { Forker } from "./checkpoints/fork.ts";
import { Rewinder } from "./checkpoints/rewind.ts";
import { Snapshots } from "./checkpoints/snapshots.ts";
import { claudeVersionProbe } from "./claude-probe.ts";
import { type CliArgs, configPath, parseArgs } from "./cli/args.ts";
import { type CliDeps, COMMANDS } from "./cli/commands.ts";
import {
  claudeSettingsPath,
  loadConfig,
  RELEASES_URL,
  type RuntimeKind,
  readToken,
  updateConfigFile,
  userHome,
} from "./config.ts";
import { createCosts } from "./costs/wiring.ts";
import { createHostChecks, type HostCheckOptions } from "./deps/wiring.ts";
import { spawnExec } from "./exec.ts";
import { listAlerts } from "./github/alerts.ts";
import { runGh, runGhIn } from "./github/gh.ts";
import { GithubService } from "./github/service.ts";
import { createHarness } from "./harness/wiring.ts";
import { HistoryIndexer } from "./history/indexer.ts";
import { Issues } from "./issues/issues.ts";
import { createKnowledge } from "./knowledge/wiring.ts";
import { AlreadyRunningError, acquireLock, EXIT_ALREADY_RUNNING } from "./lock.ts";
import type { Logger } from "./logger.ts";
import { FileLog } from "./logs/file-log.ts";
import { createLogScanner } from "./logs/scanner.ts";
import { Maintenance } from "./maintenance/maintenance.ts";
import { exists } from "./memory/exists.ts";
import { decisionLog, ProjectMemory } from "./memory/memory.ts";
import { Idle } from "./messaging/idle.ts";
import { Names } from "./names/names.ts";
import { adoptTitles } from "./names/track.ts";
import { historyExcludes } from "./permissions/auto-approve.ts";
import { credential } from "./permissions/sensitive-paths.ts";
import { createPermissions } from "./permissions/wiring.ts";
import { packPersonas } from "./personas/pack.ts";
import { createPersonas } from "./personas/wiring.ts";
import { claudeCli, filePins, Plugins, pluginDecisionLog } from "./plugins/plugins.ts";
import type { PowerContext } from "./power/keep-awake.ts";
import { createKeepAwake } from "./power/wiring.ts";
import { present } from "./present.ts";
import { UsageLedger } from "./quota/usage.ts";
import { createQuota } from "./quota/wiring.ts";
import { ReleaseFeed } from "./releases/releases.ts";
import type { ProcReader } from "./resources/resources.ts";
import { createMemoryGate, createResources, type MemoryGateDeps } from "./resources/wiring.ts";
import { ReviewFiles } from "./review/files.ts";
import { SessionFiles } from "./review/session-files.ts";
import { createChanges, createReview } from "./review/wiring.ts";
import { RoiSignals } from "./roi/signals.ts";
import { RoiSummarizer } from "./roi/summary.ts";
import { type PlatformInfo, warnIfNoRoots } from "./roots.ts";
import { createRunEnv } from "./runenv/wiring.ts";
import { FakeRuntime } from "./runtime/fake-runtime.ts";
import { type FlightdeckMcpServer, flightdeckMcpServer } from "./runtime/flightdeck-mcp.ts";
import { type CreatedOpenCode, createOpenCode } from "./runtime/opencode-wiring.ts";
import type { AgentRuntime } from "./runtime/types.ts";
import { serverGroup, startServer } from "./server.ts";
import { daemonCommand } from "./service.ts";
import { appServiceInstall } from "./service-from-app.ts";
import { osServiceContext } from "./service-os.ts";
import { createSessionManager, createSessionSettings } from "./sessions/wiring.ts";
import { SecretScanner } from "./snippets/model.ts";
import { createSnippets } from "./snippets/wiring.ts";
import { createSsh } from "./ssh/wiring.ts";
import { EventStore } from "./store/event-store.ts";
import { SummaryService } from "./summary/service.ts";
import { createTeams } from "./teams/wiring.ts";
import { createTelemetry } from "./telemetry/wiring.ts";
import { teleportImportDeps } from "./teleport/import.ts";
import { TeleportPackages, teleportDeps } from "./teleport/package.ts";
import { TeleportInbox } from "./teleport/receive.ts";
import { BUILTIN_TEMPLATES } from "./templates/builtin.ts";
import { loadTemplates } from "./templates/files.ts";
import { TaskTracker } from "./templates/tasks.ts";
import { createTerminals, type TerminalsDeps, terminalInfo } from "./terminal/wiring.ts";
import { TraceService } from "./trace/service.ts";
import { createProjectTrust, trustServer } from "./trust/wiring.ts";
import { autoUpdateOf } from "./updates/auto.ts";
import { createUpdates } from "./updates/wiring.ts";
import { DAEMON_VERSION } from "./version.ts";
import { readWatchSettings } from "./watch/watch.ts";
import { createWatch } from "./watch/wiring.ts";
import { WebhookSender } from "./webhook/sender.ts";
import { whichOnPath } from "./which.ts";
import { boundedCheckRunner } from "./workflows/check-runner.ts";
import { FolderLocks } from "./worktrees/locks.ts";
import { createWorktrees } from "./worktrees/wiring.ts";
import { createWsl, type WslItem } from "./wsl.ts";

export { type CliArgs, parseArgs, type ServiceAction } from "./cli/args.ts";
export { type CliDeps, HOOK_CONNECT_TIMEOUT_MS } from "./cli/commands.ts";

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
  const { hostPause, server: hostPauseServer } = createHostPause({
    config,
    configFile,
    // What still runs, as the auto update's idle check counts it: sessions and workflow runs (a
    // run waiting at a gate has no session but resumes after a restart).
    running: () => manager.activeSessionCount() + board.workflows.activeRuns().length,
  });
  // Phase 34: who the host's own `claude` is signed in to, for the account card.
  const account = readers ? new Account({ quota, readers }) : undefined;
  const keys = new ProjectKeys(config.hostName, options.projectGit);
  // The turn is counted when git has answered: a slow git must not stop the daemon meanwhile.
  const usage = new UsageLedger({ db: store.db, projectKey: (cwd) => keys.lookup(cwd) });
  // Phase 12: a git snapshot at the start and end of every turn, in the background.
  const snapshots = new Snapshots({ db: store.db });
  // Phase 13: the risk classifier and the projects' automatic approval, through the board (defined
  // below) and the costs.
  const { risk, autoApprove } = createPermissions({
    db: store.db,
    runtime,
    config,
    home: userHome(env),
    projectForCwd: (cwd) => board.projectForCwd(cwd),
    usage: { record: (entry) => usageIndex.record(entry) },
  });
  // The vault joins this scanner when it exists (phase 16).
  const snippetScanner = new SecretScanner();
  // Phase 12's agent editor also writes the personas published as project agents.
  const agentcfg = new AgentConfig();
  const { personaStore, prepare } = createPersonas({
    db: store.db,
    allowedRoots: config.allowedRoots,
    scanner: snippetScanner,
    agents: agentcfg,
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

  // A folder's trust (issue #196), a card's worktree read from its project's main checkout.
  const { projectTrust, trustForKnowledge } = createProjectTrust({
    db: store.db,
    config,
    projectForCwd: (cwd) => board.projectForCwd(cwd),
    log: (line) => logger.log(line),
  });
  const knowledge = createKnowledge({ config, configFile, trust: trustForKnowledge });
  const manager = createSessionManager({
    folderLocks,
    store,
    runtime,
    risk,
    autoApprove,
    config,
    projectTrust,
    keepAwake,
    // A pinned session and a card's stay awake; filled in below, once the board and the meta exist.
    awake,
    baseEnv: env,
    ...present({ opencode: opencode.runtime }),
    onQuota,
    usage,
    account,
    snapshots,
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
  const checkLoop = createCheckLoop({
    db: store.db,
    trust: projectTrust,
    readSettings: readWatchSettings,
    runner: boundedCheckRunner(),
  });
  const board = createBoard({
    folderLocks,
    preparePersonas: prepare,
    trustForKnowledge,
    log: (line) => logger.log(line),
    db: store.db,
    manager,
    quota,
    memory: memoryGate,
    pause: hostPause,
    // Issue #1361: the check loop, on the watch's checks (read when a turn ends, so the watcher made
    // below is ready by then) and the project's trust, through the bounded runner.
    checkLoop: checkLoop.board,
    vaultValues: () => heldValues(),
    config,
    configFile,
    budgets,
    projectKeys: keys,
    cardCost: costs.card.bind(costs),
    // A worktree is removed once no snapshot runs git in it (a busy folder on Windows).
    idle: snapshots.idle.bind(snapshots),
    // A card raised from an agent's findings keeps automatic approval off (issue #79).
    suspendApproval: autoApprove.suspendCard.bind(autoApprove),
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
  // The diff of every session and card, for the review (phase 11), and a plain session's commit
  // and PR (#1133).
  const { changes, sessionCommits, sessionPrs } = createChanges({
    db: store.db,
    board,
    log: logger.log.bind(logger),
    terminals,
    allowedRoots: config.allowedRoots,
    scanner: snippetScanner,
  });
  const issues = new Issues({ board, autoApprove });
  // Phase 38: the boards of GitHub Projects, read through the host's gh and synced on a timer.
  const boardSync = createBoardSync({ db: store.db, board, autoApprove, gh: runGh });
  // Phase 22: the PRs of the cards are watched and fixed, inside their limits (before the
  // automations: a watched PR is the watch's alone, #77).
  const {
    watcher: prWatcher,
    fixer: prFixer,
    watch: prWatch,
  } = createWatch({
    store,
    board,
    manager,
    costs,
    snapshots,
    history,
    scanner: snippetScanner,
    checks: boundedCheckRunner(),
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
  const snippets = createSnippets({
    db: store.db,
    config,
    scanner: snippetScanner,
    use: {
      terminals,
      manager,
      onPersonInput: (sessionId) => board.personTurnOfSession(sessionId),
      central,
      exec: spawnExec,
    },
    history: { home: userHome(env), appData: process.env.APPDATA, platform: process.platform },
  });

  const { vault, actions } = createVault({
    db: store.db,
    log: logger.log.bind(logger),
    runtimeKind,
    actions: {
      projects: (id) => board.getProject(id),
      // `ssh:` actions run on the phase 15 destinos; a vault-key destino's key is asked of the app.
      ssh: ssh.exec,
      sshTags: ssh.tagsOf,
      sshKey: ssh.vaultKeyOf,
      hostName: config.hostName,
      risk: (command, cwd) => risk.classify("Bash", { command }, cwd).level,
      projectKey: (id) => keys.known(board.getProject(id).path),
    },
  });
  heldValues = () => vault.heldValues();
  const { endpoints, messaging, teams, personaSessions, stopNames } = await createTeams({
    db: store.db,
    config,
    manager,
    board,
    central,
    keys,
    autoApprove,
    names,
    personaStore,
    prepare,
    quota,
  });
  prWatch.start();
  // Phase 24: each card's run.yaml (scripts, a block of ports, a preview), through the terminals.
  const runEnv = createRunEnv({
    db: store.db,
    portBase: config.run.portBase,
    portProbe: options.portProbe,
    terminals,
    board,
  });
  const idle = new Idle({ endpoints, messaging, host: config.hostName });
  const messagingSweep = setInterval(messaging.sweep.bind(messaging), 5 * 60_000);
  awake.pinned = (claudeSessionId) =>
    claudeSessionId !== null && central.meta.get(claudeSessionId).pinned;
  awake.cardSession = (sessionId) => board.hasRunSession(sessionId);
  const sessionSettings = createSessionSettings({
    manager,
    config,
    configFile,
    // The demo and the journeys count a "minute" in seconds, so a quiet session does not take a quarter of an hour.
    stallUnitMs:
      Number(process.env.FLIGHTDECK_STALL_UNIT_MS) > 0
        ? Number(process.env.FLIGHTDECK_STALL_UNIT_MS)
        : undefined,
  });
  const { sleeper, stall } = sessionSettings;
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
  // Issue #1439: the cards' second-opinion review, on the runtime's tool-less one-shot call.
  const reviewScanner = new SecretScanner(() => heldValues());
  const { reviewComments, cardReviews } = createReview({
    db: store.db,
    changes,
    manager,
    board,
    central,
    complete: runtime.complete?.bind(runtime),
    // The spec file of the card, with readSpec's checks (its real place inside the worktree, no
    // link on the way, no hard link), never a credential file, at most 20 KB.
    spec: async (id) => {
      const { specPath, worktreePath } = board.getCard(id);
      if (!specPath || !worktreePath || credential(specPath)) return undefined;
      return (await readSpecText(worktreePath, specPath, 20_000)) ?? undefined;
    },
    redact: (text) => reviewScanner.redact(text, false),
    persona: (language) => packPersonas(language).find((p) => p.id === "revisor")?.body ?? "",
    gates: { hostPause, quota, memory: memoryGate },
    usage: usageIndex,
  });
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
    bypass: sessionSettings.server.bypass,
    stall: sessionSettings.server.stall,
    sleep: sessionSettings.server.sleep,
    hostPause: hostPauseServer,
    memoryPause,
    keepAwake: keepAwakeSwitch,
    alerts: (cwd) => listAlerts(runGhIn, cwd),
    knowledge: serverGroup<"knowledge">()(knowledge),
    harness: serverGroup<"harness", "draft">()(harness),
    projectTrust: trustServer({ projectTrust, manager }),
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
    boardsync: boardSync.service,
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
    hostChecks: serverGroup<"hostChecks">()(hostChecks),
    sessionSettings: true,
    messaging,
    names,
    idle,
    teams,
    watch: prWatch,
    // Issue #1361: the check loop's switch, on the watch's checks and the project's trust.
    checkLoop: checkLoop.switchOf({ board, watcher: prWatcher, manager }),
    vault,
    log: logger.log.bind(logger),
    actions,
    autoApprove,
    issues,
    automations,
    history,
    board,
    runenv: { configs: runEnv.configs, manager: runEnv.manager },
    quota: serverGroup<"quota">()({ windows: quota, pause: quotaPause, history: quotaHistory }),
    usage,
    costs,
    telemetry: telemetryStore,
    bg: createBgService({
      db: store.db,
      config,
      channel: (claudeSessionId, text) => messageExternal(central, claudeSessionId, text),
      projectTrust,
      board,
      self: selfCommand,
      configFile,
    }),
    trace: new TraceService({ db: store.db, scanner: snippetScanner, telemetry: telemetryStore }),
    summary: new SummaryService({ db: store.db, scanner: snippetScanner }),
    webhook: new WebhookSender({ log: logger.log.bind(logger) }),
    telemetryOptIn,
    budgets,
    changes,
    sessionCommits,
    sessionPrs,
    review: reviewComments,
    ...(cardReviews ? { cardReview: cardReviews } : {}),
    sessionFiles: new SessionFiles({ db: store.db }),
    ssh: serverGroup<"ssh">()(ssh.server),
    snippets: serverGroup<"snippets">()(snippets),
    personas: personaStore,
    personaSessions,
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
      runs: runEnv.manager,
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
  boardSync.loop.start();
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
        for (const unwatch of runEnv.unwatch) unwatch();
        boardSync.loop.stop();
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
