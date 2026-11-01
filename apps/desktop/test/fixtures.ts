import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { realTempDir } from "../../../scripts/test/temp-dir.ts";
import { Actions } from "../../daemon/src/actions/actions.ts";
import { AgentConfig } from "../../daemon/src/agentcfg/files.ts";
import { McpConfig } from "../../daemon/src/agentcfg/mcp.ts";
import { Automations } from "../../daemon/src/automations/automations.ts";
import { Board } from "../../daemon/src/board/board.ts";
import { Central } from "../../daemon/src/central/central.ts";
import { Forker } from "../../daemon/src/checkpoints/fork.ts";
import { Rewinder } from "../../daemon/src/checkpoints/rewind.ts";
import { Snapshots } from "../../daemon/src/checkpoints/snapshots.ts";
import type { Budgets } from "../../daemon/src/costs/budgets.ts";
import { Costs } from "../../daemon/src/costs/costs.ts";
import { DEFAULT_PRICING } from "../../daemon/src/costs/pricing.ts";
import { spawnExec } from "../../daemon/src/exec.ts";
import { HistoryIndexer } from "../../daemon/src/history/indexer.ts";
import { Issues } from "../../daemon/src/issues/issues.ts";
import { Maintenance } from "../../daemon/src/maintenance/maintenance.ts";
import { ProjectMemory } from "../../daemon/src/memory/memory.ts";
import { AutoApprover } from "../../daemon/src/permissions/auto-approve.ts";
import type { RiskClassifier } from "../../daemon/src/permissions/risk.ts";
import { OpenSessionPersonas } from "../../daemon/src/personas/open-session.ts";
import { packPersonas } from "../../daemon/src/personas/pack.ts";
import { agentPublisher } from "../../daemon/src/personas/publish.ts";
import { Personas } from "../../daemon/src/personas/store.ts";
import { claudeCli, filePins, Plugins } from "../../daemon/src/plugins/plugins.ts";
import { QuotaHistory } from "../../daemon/src/quota/history.ts";
import { Quota } from "../../daemon/src/quota/quota.ts";
import { UsageLedger } from "../../daemon/src/quota/usage.ts";
import { Changes, type WatchFn } from "../../daemon/src/review/changes.ts";
import { ReviewComments } from "../../daemon/src/review/comments.ts";
import { ReviewFiles } from "../../daemon/src/review/files.ts";
import { SessionFiles } from "../../daemon/src/review/session-files.ts";
import { RunConfigs } from "../../daemon/src/runenv/config.ts";
import { RunManager } from "../../daemon/src/runenv/manager.ts";
import { CardPorts } from "../../daemon/src/runenv/ports.ts";
import { FakeRuntime } from "../../daemon/src/runtime/fake-runtime.ts";
import { type RunningServer, startServer } from "../../daemon/src/server.ts";
import { SessionManager } from "../../daemon/src/sessions/session-manager.ts";
import { HistoryImporter, type HistorySources } from "../../daemon/src/snippets/history.ts";
import { SecretScanner } from "../../daemon/src/snippets/model.ts";
import { Snippets } from "../../daemon/src/snippets/store.ts";
import { SnippetUse } from "../../daemon/src/snippets/use.ts";
import { EventStore } from "../../daemon/src/store/event-store.ts";
import { TelemetryStore } from "../../daemon/src/telemetry/store.ts";
import { TerminalManager } from "../../daemon/src/terminal/terminal-manager.ts";
import { Vault } from "../../daemon/src/vault/vault.ts";
import { fakePtys } from "../../daemon/test/pty-helpers.ts";
import { fakeRunHost } from "../../daemon/test/run-helpers.ts";
import { createWebPlatform, type WebWindow } from "../src/platform/web/index.ts";

export const TOKEN = "desktop-test-token-0123456789";

export async function waitFor<T>(
  check: () => T | undefined | null | false,
  label = "condição",
): Promise<T> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timeout: ${label}`);
    await Bun.sleep(5);
  }
}

/**
 * In-process daemon with the FakeRuntime and a board; `listen` can be called again on the same port. Its
 * history index reads `historyRoot` (a fake `~/.claude/projects`); call `history.scan()` after
 * writing transcripts there.
 */
export function daemon(
  cleanups: Array<() => unknown>,
  options: {
    allowApiKey?: boolean;
    baseEnv?: Record<string, string>;
    /** Turns on maintenance (backups in `<root>/data/backups`) with this retention. */
    retention?: { eventsDays: number; externalSessionsDays: number };
    /** The host's plan quota (phase 7); pass one on a manual clock to drive it. */
    quota?: Quota;
    /** What `host.info` says for "Abrir no terminal" (phase 8). */
    terminal?: { flightdeckdPath: string | null; wslDistro: string | null };
    /** Estimated costs (phase 8) over this daemon's own usage entries. */
    costs?: boolean;
    /** The OTLP telemetry of terminal sessions (phase 23), kept in this daemon's database. */
    telemetry?: boolean;
    /** Budgets (phase 8), built over this daemon's database. */
    budgets?: (db: EventStore["db"]) => Budgets;
    /** The quota's samples (phase 8), built over this daemon's database. */
    quotaHistory?: (db: EventStore["db"]) => QuotaHistory;
    /** The review of changes (phase 11: `changes.*`, `review.*`, `file.*`, `files.sessions`); on unless `false`. */
    review?: boolean;
    /** Replaces the recursive `fs.watch` of the changes review (to know when a watch is in place). */
    changesWatch?: WatchFn;
    /** Git snapshots per turn, rewind and fork (phase 12), over this daemon's database. */
    checkpoints?: boolean;
    /** The project's MCP servers, CLAUDE.md, agents and skills (phase 12), in this daemon's root. */
    agentcfg?: boolean;
    /** The MCP servers a live session of the fake runtime reports (phase 12). */
    mcpServers?: string[];
    /** The project's auto memory and its context budget (phase 26), under this daemon's claude-home. */
    memory?: boolean;
    /** The Claude Code plugins (phase 26), through a `claude` the test puts first on PATH. */
    plugins?: boolean;
    /** The project's issues (phase 13), read through the `gh` and `az` on the PATH. */
    issues?: boolean;
    /** The projects' automations (phase 13); the scheduler is not started. */
    automations?: boolean;
    /** The automatic approval's decisions (phase 13), kept in this daemon's database. */
    autoApprove?: boolean;
    /** The risk classifier of the permission requests (phase 13), over the daemon's root. */
    risk?: (root: string) => RiskClassifier;
    /** The cards' run environment (phase 24): a fake process host, ports always free. */
    runenv?: boolean;
    /** The host's embedded terminals (phase 14), over fake PTYs that echo what is written; "off" has them turned off. */
    terminals?: boolean | "off";
    /** The actions that use a vault secret (phase 17), over this daemon's database. */
    actions?: boolean;
    /** The snippets (phase 18) in this daemon's database; `history` names fixture shell histories. */
    snippets?: boolean | { history?: HistorySources };
    /** The personas (phase 20): the pack, the host's in this daemon's database, and open sessions. */
    personas?: boolean;
  } = {},
) {
  const root = realTempDir("fd-desk-");
  const project = join(root, "p");
  mkdirSync(project);
  const store = new EventStore(":memory:");
  const ptys = fakePtys();
  const terminals = options.terminals
    ? new TerminalManager({
        pty: ptys.factory,
        allowedRoots: [root],
        platform: "linux",
        enabled: options.terminals !== "off",
        claude: { self: ["flightdeckd"], configFile: join(root, "config.json") },
      })
    : undefined;
  if (terminals) cleanups.push(() => terminals.stop());
  const historyRoot = join(root, "claude-projects");
  mkdirSync(historyRoot);
  const history = new HistoryIndexer({ db: store.db, roots: [historyRoot] });
  const runtime = new FakeRuntime({
    delayMs: 1,
    ...(options.mcpServers ? { mcpServers: options.mcpServers } : {}),
  });
  // The host's plan quota and usage (phase 7): pass a quota on a manual clock to drive it.
  const quota = options.quota ?? new Quota({ pauseAt: 0.9 });
  cleanups.push(() => quota.stop());
  const usage = new UsageLedger({ db: store.db, projectKey: (cwd) => cwd });
  // Phase 12: a snapshot at the edges of every turn, like main.ts wires it.
  const snapshots = options.checkpoints ? new Snapshots({ db: store.db }) : undefined;
  const personaStore = options.personas
    ? new Personas({
        db: store.db,
        allowedRoots: [root],
        scanner: new SecretScanner(),
        pack: packPersonas,
        // Published personas go through phase 12's agent editor, as main.ts wires it.
        publisher: agentPublisher(new AgentConfig({ claudeDir: join(root, "claude-home") })),
      })
    : undefined;
  const manager = new SessionManager({
    ...(personaStore ? { personas: personaStore } : {}),
    ...(snapshots
      ? {
          onTurnEdge: (edge) =>
            snapshots.enqueue({
              cwd: edge.cwd,
              claudeSessionId: edge.claudeSessionId,
              kind: edge.kind,
              ...(edge.prompt !== undefined ? { prompt: edge.prompt } : {}),
              ...(edge.turnUuid !== undefined ? { turnUuid: edge.turnUuid } : {}),
            }),
        }
      : {}),
    onQuota: (readings) => quota.record(readings),
    onTurn: (sessionId, cwd, turn) => usage.record(sessionId, cwd, turn),
    store,
    runtime,
    allowedRoots: [root],
    defaultPermissionMode: "default",
    allowApiKey: options.allowApiKey ?? false,
    baseEnv: options.baseEnv ?? {},
    ...(options.risk ? { risk: options.risk(root) } : {}),
  });
  const rewinder = snapshots ? new Rewinder({ snapshots, sessions: manager }) : undefined;
  const forker = rewinder ? new Forker({ runtime, manager, rewinder }) : undefined;
  // The user's own ~/.claude.json and ~/.claude stay untouched: both live in this daemon's root.
  const mcp = options.agentcfg
    ? new McpConfig({ userConfigPath: join(root, "claude.json"), timeoutMs: 5000 })
    : undefined;
  const agentcfg = options.agentcfg
    ? new AgentConfig({ claudeDir: join(root, "claude-home") })
    : undefined;
  const memory = options.memory
    ? new ProjectMemory({
        claudeDir: join(root, "claude-home"),
        managedClaudeMd: join(root, "managed", "CLAUDE.md"),
      })
    : undefined;
  const plugins = options.plugins
    ? new Plugins({ cli: claudeCli(), pins: filePins(join(root, "plugin-pins.json")) })
    : undefined;
  const board = new Board({ db: store.db, manager, allowedRoots: [root], quota });
  cleanups.push(() => board.stop());
  const runHost = options.runenv ? fakeRunHost() : undefined;
  const runConfigs = new RunConfigs({ db: store.db });
  const runManager = runHost
    ? new RunManager({
        db: store.db,
        configs: runConfigs,
        ports: new CardPorts({ db: store.db, isFree: async () => true }),
        host: runHost.host,
        card: (id) => board.getCard(id),
        project: (id) => board.getProject(id),
        waitReady: async () => "ready",
      })
    : undefined;
  // Hooks go to a settings.json of this daemon only, never the home of the test process.
  const settingsFile = join(root, "claude-home", "settings.json");
  const configFile = join(root, "config.json");
  writeFileSync(configFile, JSON.stringify({ token: TOKEN }));
  const central = new Central({
    ...(snapshots ? { snapshots } : {}),
    db: store.db,
    manager,
    hooks: { port: 0, permissionTimeoutS: 600, staleAfterS: 900 },
    dataDir: join(root, "data"),
    hostName: "h1",
    configFile,
    selfCommand: [process.execPath, "run", "flightdeckd.ts"],
    settingsPath: () => settingsFile,
  });
  cleanups.push(() => central.stop());
  // The daemon's database lives in its dataDir, so the folder always exists there.
  if (options.retention) mkdirSync(join(root, "data"), { recursive: true });
  const maintenance = options.retention
    ? new Maintenance({
        db: store.db,
        dataDir: join(root, "data"),
        retention: { usageDays: 400, ...options.retention },
        backup: { enabled: true, keep: 7 },
      })
    : undefined;
  const telemetry = options.telemetry ? new TelemetryStore(store.db) : undefined;
  const costs = options.costs ? new Costs({ db: store.db, pricing: DEFAULT_PRICING }) : undefined;
  const budgets = options.budgets?.(store.db);
  const issues = options.issues || options.automations ? new Issues({ board }) : undefined;
  const automations =
    options.automations && issues ? new Automations({ db: store.db, board, issues }) : undefined;
  const autoApprove = options.autoApprove
    ? new AutoApprover({
        db: store.db,
        runtime,
        dataDir: join(root, "data"),
        context: (cwd) => {
          const found = board.projectForCwd(cwd);
          return found
            ? { projectId: found.project.id, settings: found.project.autoApprove }
            : null;
        },
      })
    : undefined;
  const actions = options.actions
    ? new Actions({
        db: store.db,
        vault: new Vault({ log: () => {} }),
        hostBase: root,
        requestTimeoutMs: 3000,
        projects: (id) => board.getProject(id),
      })
    : undefined;
  if (actions) cleanups.push(() => actions.stop());
  const snippetScanner = new SecretScanner();
  const snippets = options.snippets
    ? new Snippets({ db: store.db, allowedRoots: [root], scanner: snippetScanner })
    : undefined;
  const snippetHistory =
    snippets && typeof options.snippets === "object" && options.snippets.history
      ? new HistoryImporter({
          sources: options.snippets.history,
          scanner: snippetScanner,
          snippets,
        })
      : undefined;
  // Like the real daemon, costs come with the quota's history.
  const quotaHistory =
    options.quotaHistory?.(store.db) ??
    (options.costs ? new QuotaHistory({ db: store.db }) : undefined);
  // Like the real daemon: the diff of every session and card, with comments, files and sessions.
  const changes =
    options.review !== false
      ? new Changes({
          db: store.db,
          board,
          ...(options.changesWatch ? { watch: options.changesWatch } : {}),
        })
      : undefined;
  const review = changes
    ? {
        changes,
        review: new ReviewComments({ db: store.db, changes, manager, board, central }),
        sessionFiles: new SessionFiles({ db: store.db }),
        files: new ReviewFiles({ changes, dataDir: join(root, "data"), allowedRoots: [root] }),
      }
    : undefined;
  /** `features` replaces what `host.info` announces (a host without some phase 7 feature). */
  const listen = (port = 0, pingIntervalMs?: number, features?: string[]): RunningServer => {
    const server = startServer({
      ...(pingIntervalMs ? { pingIntervalMs } : {}),
      ...(features ? { features } : {}),
      // The folder picker is on, like in the real daemon.
      fsDirs: true,
      manager,
      history,
      board,
      quota,
      usage,
      central,
      ...(maintenance ? { maintenance } : {}),
      ...(options.terminal ? { terminal: options.terminal } : {}),
      ...(costs ? { costs } : {}),
      ...(telemetry ? { telemetry } : {}),
      ...(budgets ? { budgets } : {}),
      ...(quotaHistory ? { quotaHistory } : {}),
      ...(review ?? {}),
      ...(snapshots && rewinder && forker ? { snapshots, rewinder, forker } : {}),
      ...(mcp && agentcfg ? { mcp, agentcfg } : {}),
      ...(memory ? { memory } : {}),
      ...(plugins ? { plugins } : {}),
      ...(issues ? { issues } : {}),
      ...(options.issues && issues ? { issues } : {}),
      ...(automations ? { automations } : {}),
      ...(autoApprove ? { autoApprove } : {}),
      ...(terminals ? { terminals } : {}),
      ...(runManager ? { runenv: { configs: runConfigs, manager: runManager } } : {}),
      ...(actions ? { actions } : {}),
      ...(snippets
        ? {
            snippets,
            snippetUse: new SnippetUse({
              snippets,
              ...(terminals ? { terminals } : {}),
              manager,
              central,
              exec: spawnExec,
              allowedRoots: [root],
            }),
          }
        : {}),
      ...(snippetHistory ? { snippetHistory } : {}),
      ...(personaStore
        ? {
            personas: personaStore,
            personaSessions: new OpenSessionPersonas({ personas: personaStore, manager, central }),
          }
        : {}),
      hostName: "h1",
      bind: "127.0.0.1",
      port,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    return server;
  };
  return {
    quota,
    usage,
    costs,
    telemetry,
    budgets,
    manager,
    project,
    root,
    listen,
    history,
    historyRoot,
    runtime,
    board,
    snapshots,
    mcp,
    agentcfg,
    memory,
    central,
    maintenance,
    settingsFile,
    configFile,
    eventStore: store,
    automations,
    autoApprove,
    ptys,
    runHost,
    actions,
  };
}

/**
 * The web platform over a fake window: the UI tests run on the same implementation the PWA will
 * use. Tokens live in `tokens` (injected as the secrets map); notifications are recorded through
 * a fake browser Notification API.
 */
export function memoryPlatform(focused = false, language = "pt-BR") {
  const items = new Map<string, string>();
  const tokens = new Map<string, string>();
  const notifications: Array<{ title: string; body: string }> = [];
  /** The notification objects themselves, to simulate a click (`onclick`). */
  const shown: Array<{ onclick?: (() => void) | null }> = [];
  /** Files saved through the save dialog; `cancelSave` makes the next dialog a cancel. */
  const saved: Array<{ name: string; text: string }> = [];
  const save = { cancel: false };
  let onHashChange: (() => void) | null = null;
  const win: WebWindow = {
    localStorage: {
      getItem: (k) => items.get(k) ?? null,
      setItem: (k, v) => {
        items.set(k, v);
      },
    },
    document: { hasFocus: () => focused, title: "Flightdeck" },
    // The suite reads the app in Portuguese; tests of English pass their own language.
    navigator: { language },
    location: { hash: "" },
    open: () => null,
    addEventListener: (_type, listener) => {
      onHashChange = listener;
    },
    removeEventListener: () => {
      onHashChange = null;
    },
    showSaveFilePicker: async ({ suggestedName }) => {
      if (save.cancel) {
        save.cancel = false;
        throw Object.assign(new Error("The user aborted a request."), { name: "AbortError" });
      }
      return {
        createWritable: async () => {
          let text = "";
          return {
            write: async (chunk: string) => {
              text += chunk;
            },
            close: async () => {
              saved.push({ name: suggestedName, text });
            },
          };
        },
      };
    },
    Notification: Object.assign(
      function (this: { onclick?: () => void }, title: string, options?: { body?: string }) {
        notifications.push({ title, body: options?.body ?? "" });
        shown.push(this);
      } as unknown as NonNullable<WebWindow["Notification"]>,
      { permission: "granted", requestPermission: async () => "granted" },
    ),
  };
  const platform = createWebPlatform(win, tokens);
  /** Simulates the OS opening a `flightdeck://` link. */
  const deepLink = (url: string) => {
    win.location.hash = `#link=${encodeURIComponent(url)}`;
    onHashChange?.();
  };
  return { platform, items, tokens, notifications, shown, win, deepLink, saved, save };
}
