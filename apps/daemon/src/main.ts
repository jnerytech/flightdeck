import { unwatchFile, watchFile } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { Account } from "./account/account.ts";
import { demoAccountReaders } from "./account/demo.ts";
import { accountReaders } from "./account/readers.ts";
import { createVault } from "./actions/wiring.ts";
import { createActivity } from "./activity/wiring.ts";
import { assistantService } from "./assistant/factory.ts";
import { assistantDir } from "./assistant/paths.ts";
import { createBoardWork } from "./automations/wiring.ts";
import { createBg } from "./bg/wiring.ts";
import { createBoard, createCheckLoop, createHostPause } from "./board/wiring.ts";
import { messageExternal } from "./central/central.ts";
import { type AsyncGitRunner, ProjectKeys } from "./central/project-key.ts";
import { createCentral } from "./central/wiring.ts";
import { Snapshots } from "./checkpoints/snapshots.ts";
import { createCheckpoints } from "./checkpoints/wiring.ts";
import { type CliArgs, configPath, parseArgs } from "./cli/args.ts";
import { type CliDeps, COMMANDS } from "./cli/commands.ts";
import {
  claudeSettingsPath,
  loadConfig,
  type RuntimeKind,
  readToken,
  updateConfigFile,
  userHome,
} from "./config.ts";
import { createCosts } from "./costs/wiring.ts";
import { createHostChecks, type HostCheckOptions } from "./deps/wiring.ts";
import { runGh } from "./github/gh.ts";
import { createGithub } from "./github/wiring.ts";
import { createHarness } from "./harness/wiring.ts";
import { createHistory } from "./history/wiring.ts";
import {
  AlreadyRunningError,
  acquireLock,
  DAEMON_VERSION,
  EXIT_ALREADY_RUNNING,
  type Logger,
  present,
  spawnExec,
} from "./kernel/index.ts";
import { createKnowledge } from "./knowledge/wiring.ts";
import { createHostLog } from "./logs/wiring.ts";
import { createMaintenance } from "./maintenance/index.ts";
import { exists } from "./memory/index.ts";
import { createNames } from "./names/wiring.ts";
import { historyExcludes } from "./permissions/auto-approve.ts";
import { createPermissions, type PermissionsDeps } from "./permissions/wiring.ts";
import { createPersonas } from "./personas/wiring.ts";
import { createAgentSetup } from "./plugins/index.ts";
import type { PowerContext } from "./power/keep-awake.ts";
import { createKeepAwake } from "./power/wiring.ts";
import { type PlatformInfo, warnIfNoRoots } from "./projects/index.ts";
import { createQuota, createUsage } from "./quota/wiring.ts";
import { createReleases } from "./releases/wiring.ts";
import type { ProcReader } from "./resources/resources.ts";
import {
  createMemoryGate,
  createResourcesModule,
  type MemoryGateDeps,
} from "./resources/wiring.ts";
import { createReview } from "./review/wiring.ts";
import { createRoi } from "./roi/wiring.ts";
import { createRunEnv } from "./runenv/wiring.ts";
import { FakeRuntime } from "./runtime/fake-runtime.ts";
import { type FlightdeckMcpServer, flightdeckMcpServer } from "./runtime/flightdeck-mcp.ts";
import { claudeVersionProbe } from "./runtime/index.ts";
import { createOpenCodeServer } from "./runtime/opencode-server.ts";
import { createOpenCode } from "./runtime/opencode-wiring.ts";
import type { AgentRuntime } from "./runtime/types.ts";
import { createModuleRunner, serverGroup } from "./server/index.ts";
import { startServer } from "./server.ts";
import { daemonCommand, osServiceContext } from "./service/index.ts";
import { createServiceInstall } from "./service/wiring.ts";
import { createSessionManager, createSessionSettings } from "./sessions/wiring.ts";
import { SecretScanner } from "./snippets/model.ts";
import { createSnippets } from "./snippets/wiring.ts";
import { createSsh } from "./ssh/wiring.ts";
import { EventStore } from "./store/event-store.ts";
import { createSummary } from "./summary/wiring.ts";
import { createTeams } from "./teams/wiring.ts";
import { createTelemetry } from "./telemetry/wiring.ts";
import { createTeleport } from "./teleport/wiring.ts";
import { createTerminals, type TerminalsDeps } from "./terminal/wiring.ts";
import { createTrace } from "./trace/wiring.ts";
import { createProjects, createProjectTrust } from "./trust/wiring.ts";
import { createUi } from "./ui/wiring.ts";
import { createUpdates } from "./updates/index.ts";
import { readWatchSettings } from "./watch/settings.ts";
import { createWebhook } from "./webhook/wiring.ts";
import { boundedCheckRunner } from "./workflows/check-runner.ts";
import { FolderLocks } from "./worktrees/locks.ts";
import { createWorktreesModule } from "./worktrees/wiring.ts";
import { createWsl, type WslItem } from "./wsl/index.ts";

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
  const hostLog = createHostLog({
    console: console_,
    dir: options.logDir ?? join(userHome(env), ".flightdeck", "logs"),
    home: userHome(env),
    config,
    currentToken: () => currentToken,
    heldValues: () => heldValues(),
  });
  const { logger, fileLog } = hostLog;
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
  // #2094: the domains that give main.ts one module each; the rest still wire by hand below.
  const domains = createModuleRunner();
  await domains.add(hostLog);
  await domains.add(createOpenCodeServer(opencode));
  const { quota, onQuota } = await domains.add(createQuota({ db: store.db, config, configFile }));
  // Issue #1343: new cards wait while memory is at or above resources.pauseAt. FLIGHTDECK_SERVICE_GUARD
  // is set only by the test preload, never in production: under it nothing of the real machine is
  // read (a busy runner would hold every board test), so the hold stays open unless a test injects one.
  const { memoryGate } = await domains.add(
    createMemoryGate({
      config,
      configFile,
      reading:
        options.memoryReading ?? (process.env.FLIGHTDECK_SERVICE_GUARD ? () => null : undefined),
    }),
  );
  // Issue #1404: the person's pause of new card runs, kept in the config.
  const { hostPause } = await domains.add(
    createHostPause({
      config,
      configFile,
      // What still runs, as the auto update's idle check counts it: sessions and workflow runs (a
      // run waiting at a gate has no session but resumes after a restart).
      running: (): number => manager.activeSessionCount() + board.workflows.activeRuns().length,
    }),
  );
  // Phase 34: who the host's own `claude` is signed in to, for the account card.
  const account = readers ? new Account({ quota, readers }) : undefined;
  const keys = new ProjectKeys(config.hostName, options.projectGit);
  // The turn is counted when git has answered: a slow git must not stop the daemon meanwhile.
  const { usage } = await domains.add(
    createUsage({ db: store.db, projectKey: (cwd) => keys.lookup(cwd) }),
  );
  // Phase 12: a git snapshot at the start and end of every turn, in the background.
  const snapshots = new Snapshots({ db: store.db });
  // Phase 13: the risk classifier and the projects' automatic approval, through the board (defined
  // below) and the costs.
  const { risk, autoApprove } = await domains.add(
    createPermissions({
      db: store.db,
      runtime,
      config,
      home: userHome(env),
      // The return type is named: `board` is made below from `autoApprove`, and `domains.add` would loop.
      projectForCwd: (cwd): ReturnType<PermissionsDeps["projectForCwd"]> =>
        board.projectForCwd(cwd),
      usage: { record: (entry) => usageIndex.record(entry) },
    }),
  );
  // The vault joins this scanner when it exists (phase 16).
  const snippetScanner = new SecretScanner();
  // What a session starts with: agents, MCP, plugins, auto memory, templates and their tasks.
  const agentSetup = createAgentSetup({
    dataDir: config.dataDir,
    claudePath,
  });
  const { personaStore, prepare } = createPersonas({
    db: store.db,
    allowedRoots: config.allowedRoots,
    scanner: snippetScanner,
    agents: agentSetup.agentcfg,
  });
  const awake: {
    pinned?: (claudeSessionId: string | null) => boolean;
    cardSession?: (sessionId: string) => boolean;
  } = {};
  const { keepAwake } = await domains.add(
    createKeepAwake({ powerContext: options.powerContext, config, configFile }),
  );

  // The host's default mode and lock (phase 33), kept in the config like the other settings.
  await domains.add(createUi({ config, configFile }));

  // Folders a worktree removal holds: nothing starts in one while it is being removed.
  const folderLocks = new FolderLocks();

  // A folder's trust (issue #196), a card's worktree read from its project's main checkout.
  const { projectTrust, trustForKnowledge } = createProjectTrust({
    db: store.db,
    config,
    projectForCwd: (cwd) => board.projectForCwd(cwd),
    log: (line) => logger.log(line),
  });
  await domains.add(createKnowledge({ config, configFile, trust: trustForKnowledge }));
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
  await domains.add(createCheckpoints({ snapshots, manager, runtime, prepare }));
  await domains.add(createProjects({ keys, projectTrust, manager }));
  // Phase 21: every session of this host has a standard name and an alias that addresses it.
  const { names } = await domains.add(createNames(store.db));
  const { history } = await domains.add(
    createHistory({ db: store.db, config, names, manager, log: (m) => logger.log(m) }),
  );
  // Issue #100: the packages this host teleports to another, and the ones other hosts send here.
  await domains.add(
    createTeleport({
      manager,
      names,
      indexer: history,
      config,
      // The meta is made with the central below; an import reads it only once the server runs.
      meta: { set: (claudeSessionId, patch) => central.meta.set(claudeSessionId, patch) },
      scan: snippetScanner.scan.bind(snippetScanner),
      log: logger.log.bind(logger),
    }),
  );
  const { costs, usageIndex, budgets } = await domains.add(
    createCosts({
      db: store.db,
      config,
      readPricing: async () => (await loadConfig(configFile)).pricing,
      excludeCwds: historyExcludes(config),
      projectKey: (cwd) => keys.known(cwd),
      warmKeys: (cwds) => Promise.all(cwds.map((cwd) => keys.resolve(cwd))),
      quota,
      log: (m) => logger.log(m),
      history,
    }),
  );
  const checkLoop = createCheckLoop({
    db: store.db,
    trust: projectTrust,
    readSettings: readWatchSettings,
    runner: boundedCheckRunner(),
  });
  // Real shells behind a PTY, kept across connections; none outlives the daemon.
  const { terminals } = await domains.add(
    await createTerminals({
      config,
      configFile,
      folderLocks,
      pty: options.pty,
      self: selfCommand,
      env,
      log: (message) => logger.log(message),
    }),
  );
  const { board } = await domains.add(
    createBoard({
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
    }),
  );
  // Phase 24: each card's run.yaml (scripts, a block of ports, a preview), through the terminals.
  const { manager: runs } = await domains.add(
    createRunEnv({
      db: store.db,
      portBase: config.run.portBase,
      portProbe: options.portProbe,
      terminals,
      board,
    }),
  );
  // The issues, the GitHub Projects' boards, the PR watch and the automations around the cards.
  const { issues } = await domains.add(
    createBoardWork({
      store,
      board,
      autoApprove,
      gh: runGh,
      manager,
      costs,
      snapshots,
      history,
      scanner: snippetScanner,
      checks: boundedCheckRunner(),
      config,
      log: logger.log.bind(logger),
      checkLoopOf: (watcher) => checkLoop.switchOf({ board, watcher, manager }),
    }),
  );
  await domains.add(createMaintenance({ db: store.db, config, snapshots }));
  await domains.add(
    createUpdates(config, {
      configFile,
      idle: () => manager.activeSessionCount() === 0 && board.workflows.activeRuns().length === 0,
      log: logger.log.bind(logger),
    }),
  );
  const { telemetryStore } = await domains.add(
    await createTelemetry({
      db: store.db,
      config,
      configFile,
      settingsPath: claudeSettingsPath,
      log: logger,
    }),
  );
  await domains.add(
    createTrace({ db: store.db, scanner: snippetScanner, telemetry: telemetryStore }),
  );
  await domains.add(createSummary({ db: store.db, scanner: snippetScanner }));
  await domains.add(createWebhook({ log: logger.log.bind(logger) }));
  await domains.add(createRoi({ db: store.db, keyOf: (path) => keys.known(path) }));
  await domains.add(createGithub({ config, board, issues, manager }));
  await domains.add(createActivity({ db: store.db, quota: () => quota.windows() }));
  await domains.add(createReleases());
  const { central } = await domains.add(
    createCentral({
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
    }),
  );
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

  const { vault, actions } = await domains.add(
    createVault({
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
    }),
  );
  heldValues = () => vault.heldValues();
  await domains.add(
    await createTeams({
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
    }),
  );
  awake.pinned = (claudeSessionId) =>
    claudeSessionId !== null && central.meta.get(claudeSessionId).pinned;
  awake.cardSession = (sessionId) => board.hasRunSession(sessionId);
  await domains.add(
    createSessionSettings({
      manager,
      config,
      configFile,
      // The demo and the journeys count a "minute" in seconds, so a quiet session does not take a quarter of an hour.
      stallUnitMs:
        Number(process.env.FLIGHTDECK_STALL_UNIT_MS) > 0
          ? Number(process.env.FLIGHTDECK_STALL_UNIT_MS)
          : undefined,
    }),
  );
  // The wrapper finds the receptor through this file: nothing is served before it is there.
  await central.ready();
  // A session that was open before the restart may be sent a message before anything else looks
  // at its folder: read the git boundaries of every folder first, so the lazy reattach finds them.
  // `prepare` answers every filesystem error itself (a folder it cannot read is a boundary).
  await projectTrust.prepareSessions(manager.list());
  await domains.add(
    createHarness({
      runtime,
      quota,
      scanner: snippetScanner,
      cwd: assistantDir(config.dataDir),
      config,
    }),
  );
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
  // Issue #1439: the diffs, a plain session's commit and PR, the files viewer, the comments and the
  // cards' second-opinion review, on the runtime's tool-less one-shot call.
  await domains.add(
    createReview({
      db: store.db,
      board,
      log: logger.log.bind(logger),
      terminals,
      allowedRoots: config.allowedRoots,
      scanner: snippetScanner,
      dataDir: config.dataDir,
      manager,
      central,
      complete: runtime.complete?.bind(runtime),
      heldValues: () => heldValues(),
      gates: { hostPause, quota, memory: memoryGate },
      usage: usageIndex,
    }),
  );
  await domains.add(
    createHostChecks({
      config,
      env,
      opencode,
      claude,
      claudePath,
      account: async () => (await account?.get())?.status ?? null,
      options,
    }),
  );
  await domains.add(
    await createResourcesModule({
      dataDir: config.dataDir,
      sessions: manager.list.bind(manager),
      // With the terminal off there are none to list, and the read must not fail on it (#937).
      terminals: () => (terminals.enabled ? terminals.list() : []),
      pidOf: terminals.pidOf.bind(terminals),
      ...present({ proc: options.resourcesProc }),
    }),
  );
  await domains.add(
    createWorktreesModule({
      board,
      sessions: manager,
      runs,
      terminals,
      externals: central.external,
      locks: folderLocks,
    }),
  );
  await domains.add(
    createBg({
      db: store.db,
      config,
      channel: (claudeSessionId, text) => messageExternal(central, claudeSessionId, text),
      projectTrust,
      board,
      self: selfCommand,
      configFile,
    }),
  );
  await domains.add(
    createServiceInstall({
      config: args.config ?? null,
      configFile,
      ctxOf: options.serviceContext ?? osServiceContext,
      self: options.serviceSelf ?? selfCommand,
    }),
  );
  const server = startServer({
    ...domains.server(),
    ...(options.projectGit ? { projectGit: options.projectGit } : {}),
    manager,
    ...present({ assistant }),
    roots: serverGroup<"roots", "platform">()({
      ...present({ platform: options.rootsPlatform }),
      persist: (roots) =>
        updateConfigFile(configFile, (raw) => ({ ...raw, allowedRoots: [...roots] })),
      picker: true,
    }),
    // Sign-in with GitHub through the host's gh, and start from a repo or an issue (phase 37).
    log: logger.log.bind(logger),
    ssh: serverGroup<"ssh">()(ssh.server),
    snippets: serverGroup<"snippets">()(snippets),
    agentSetup: serverGroup<"agentSetup">()(agentSetup),
    hostName: config.hostName,
    bind: config.bind,
    port: config.port,
    token: config.token,
    // `roots.add` pushes into this same array, so every service sees the new folder at once.
    allowedRoots: config.allowedRoots,
    allowedNetworks: config.allowedNetworks,
    ...present({ claude, account, onShutdown: options.onShutdown }),
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
  await domains.started();
  warnIfNoRoots(config, logger);

  let stopped: Promise<void> | null = null;
  return {
    url: server.url,
    runtime,
    logger,
    stop: () => {
      stopped ??= (async () => {
        unwatchFile(configFile, onConfigChange);
        // The modules' stops in the record's phases, around the domains still wired by hand:
        // keep-awake first; the rest in reverse construction order (the board work, built after the
        // board, before it); then the server; then the late ones (costs, teleport, history, quota).
        await domains.stop(async () => {
          await wsl?.stop();
          actions.stop();
          vault.stop();
          await central.stop();
          await manager.shutdown();
          await server.stop();
        });
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
