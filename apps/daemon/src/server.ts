import {
  type ActivitySinceResult,
  type AutoUpdateStatus,
  type CardReviewResult,
  CLOSE_HEARTBEAT,
  CLOSE_UNAUTHORIZED,
  Command,
  CommandHeader,
  type CommandResults,
  type CommandType,
  type DepsResult,
  type DoctorResult,
  type HarnessApplied,
  type HarnessCommitted,
  type HarnessDraft,
  type HarnessPreview,
  type HarnessStack,
  type HostPauseStatus,
  type KeepAwakeStatus,
  type KnowledgeEntry,
  type KnowledgeIndexResult,
  type KnowledgeKind,
  type KnowledgeListResult,
  type KnowledgeStatus,
  MIN_PROTOCOL_VERSION,
  Pong,
  PROTOCOL_VERSION,
  type ProjectLoad,
  type ProjectTrustState,
  type ServiceInstallResult,
  type UiSettings,
  WS_PATH,
} from "@flightdeck/protocol";
import { z } from "zod";
import type { Account } from "./account/account.ts";
import type { Actions } from "./actions/actions.ts";
import type { AgentConfig } from "./agentcfg/files.ts";
import type { McpConfig } from "./agentcfg/mcp.ts";
import type { AssistantService } from "./assistant/service.ts";
import type { Automations } from "./automations/automations.ts";
import type { BgService } from "./bg/service.ts";
import type { Board } from "./board/board.ts";
import type { CheckLoopSwitch } from "./board/check-loop.ts";
import type { BoardSyncService } from "./boardsync/service.ts";
import type { Central } from "./central/central.ts";
import type { AsyncGitRunner } from "./central/project-key.ts";
import type { Forker } from "./checkpoints/fork.ts";
import type { Rewinder } from "./checkpoints/rewind.ts";
import type { Snapshots } from "./checkpoints/snapshots.ts";
import type { Budgets } from "./costs/budgets.ts";
import type { Costs } from "./costs/costs.ts";
import type { AlertList } from "./github/alerts.ts";
import type { GithubService } from "./github/service.ts";
import type { PreviewPart } from "./harness/preview.ts";
import type { HarnessTemplates, TemplateMarkdown } from "./harness/templates-store.ts";
import type { HistoryIndexer } from "./history/indexer.ts";
import type { Issues } from "./issues/issues.ts";
import { DAEMON_VERSION, FlightdeckError } from "./kernel/index.ts";
import type { KnowledgeSwitch } from "./knowledge/switch.ts";
import type { FileLog } from "./logs/file-log.ts";
import type { Maintenance } from "./maintenance/maintenance.ts";
import type { ProjectMemory } from "./memory/memory.ts";
import type { Idle } from "./messaging/idle.ts";
import type { Messaging } from "./messaging/messages.ts";
import type { Names } from "./names/names.ts";
import { DEFAULT_ALLOWED_NETWORKS, ipInNetworks } from "./networks.ts";
import type { AutoApprover } from "./permissions/auto-approve.ts";
import type { OpenSessionPersonas } from "./personas/open-session.ts";
import type { Personas } from "./personas/store.ts";
import type { Plugins } from "./plugins/plugins.ts";
import type { GitRunner, PlatformInfo } from "./projects/index.ts";
import type { QuotaHistory } from "./quota/history.ts";
import type { Quota } from "./quota/quota.ts";
import type { UsageLedger } from "./quota/usage.ts";
import type { ReleaseFeed } from "./releases/releases.ts";
import type { Resources } from "./resources/resources.ts";
import type { Changes } from "./review/changes.ts";
import type { ReviewComments } from "./review/comments.ts";
import type { ReviewFiles } from "./review/files.ts";
import type { SessionCommits } from "./review/session-commit.ts";
import type { SessionFiles } from "./review/session-files.ts";
import type { SessionPrs } from "./review/session-pr.ts";
import type { RoiSummarizer } from "./roi/summary.ts";
import type { RunConfigs } from "./runenv/config.ts";
import type { RunManager } from "./runenv/manager.ts";
import type { OpenCodeInfo } from "./runtime/opencode-discovery.ts";
import { closeLine } from "./server/close-log.ts";
import { serverContext } from "./server/context.ts";
import { drainAll } from "./server/delta-coalescer.ts";
import { type Call, type Handler, runHandler } from "./server/dispatch.ts";
import { HANDLERS } from "./server/handlers/index.ts";
import { ackError, type Connection, decode, type Socket, send } from "./server/transport.ts";
import type { SessionManager } from "./sessions/session-manager.ts";
import type { HistoryImporter } from "./snippets/history.ts";
import type { Snippets } from "./snippets/store.ts";
import type { SnippetUse } from "./snippets/use.ts";
import type { AskpassBroker } from "./ssh/askpass.ts";
import type { SshConnector } from "./ssh/connect.ts";
import type { HostKeys } from "./ssh/hostkey.ts";
import type { SshImporter } from "./ssh/import.ts";
import type { SshTargets } from "./ssh/targets.ts";
import type { SummaryService } from "./summary/service.ts";
import type { Teams } from "./teams/teams.ts";
import type { TelemetryOptIn } from "./telemetry/optin.ts";
import type { TelemetryStore } from "./telemetry/store.ts";
import type { TeleportImportDeps } from "./teleport/import.ts";
import type { TeleportPackages } from "./teleport/package.ts";
import type { TeleportInbox } from "./teleport/receive.ts";
import type { LoadedTemplates } from "./templates/files.ts";
import type { TaskTracker } from "./templates/tasks.ts";
import type { TerminalManager } from "./terminal/terminal-manager.ts";
import { tokenMatches } from "./token.ts";
import type { TraceService } from "./trace/service.ts";
import type { DaemonUpdater } from "./updates/apply.ts";
import type { UpdateChecker } from "./updates/check.ts";
import type { Vault } from "./vault/vault.ts";
import type { PrWatch } from "./watch/service.ts";
import type { WebhookSender } from "./webhook/sender.ts";
import type { Worktrees } from "./worktrees/worktrees.ts";

/**
 * How often the daemon pings each authenticated client. A client is closed after
 * `MAX_MISSED_PINGS` unanswered pings AND that many intervals without any frame from it: a page
 * starved of CPU may be late with its pongs, but anything it sends shows it is there.
 */
export const PING_INTERVAL_MS = 15_000;
const MAX_MISSED_PINGS = 4;

/** Phase 7, #1593: the quota domain's part of the server, each service optional. */
interface QuotaServer {
  /** The plan's windows behind `quota.get`, `quota.watch` and the statusline. */
  windows?: Quota;
  /** Changes the guard "new cards wait from N%" (issue #1218): the config file first, then the running `Quota`. */
  pause?: { set(pauseAt: number | null): void | Promise<void> };
  /** The quota's samples behind `quota.history` (phase 8). */
  history?: QuotaHistory;
}

/** Phase 11, #1593: the review domain's part of the server, each service optional. */
interface ReviewServer {
  /** The diff of sessions and cards behind `changes.*`. */
  changes?: Changes;
  /** #1133: a plain session's files committed on a new branch in its own checkout. */
  sessionCommits?: SessionCommits;
  /** #1133: a plain session's branch pushed and its PR opened. */
  sessionPrs?: SessionPrs;
  /** Inline comments behind `review.*`. */
  comments?: ReviewComments;
  /** Issue #1439: the cards' second-opinion review, for the near-only `card.review`. */
  cardReview?: { start(cardId: string, language?: "en" | "pt-BR"): Promise<CardReviewResult> };
  /** Revert and edit behind `changes.revert`, `changes.undoRevert` and `file.*`. */
  files?: ReviewFiles;
  /** Which session wrote which file, behind `files.sessions` and `session.files`. */
  sessionFiles?: SessionFiles;
}

/** The allowed folders' services around `allowedRoots` (#1593). */
interface RootsServer {
  /** Keeps the allowed folders in the config file after `roots.add`. */
  persist?: (roots: readonly string[]) => void | Promise<void>;
  /** What decides the system folders `roots.add` refuses; the process's own when absent (tests give theirs). */
  platform?: PlatformInfo;
  /** Announce `fs.dirs` in `host.info`: the app offers its folder picker only to such a host. */
  picker?: boolean;
}

/** #1593: the host's projects, each service optional. */
interface ProjectsServer {
  /** Looks up the project of a folder before a session is created in it (without blocking). */
  warmKey?: (cwd: string) => Promise<unknown>;
  /** The project key of a folder, asked without blocking: `history.list` filters by it. */
  keyOf?: (cwd: string) => Promise<string>;
  /** Which projects' own hooks and MCP servers run without a prompt (`project.trust.*`). */
  trust?: {
    /**
     * Reads what `state` and `set` compare with (the roots' real paths) and the git boundaries of
     * `paths` (a nested clone is not covered by the folder around it) before they answer.
     */
    refresh(paths?: readonly string[]): Promise<void>;
    state(paths: string[]): ProjectTrustState[];
    inspect(path: string): Promise<ProjectLoad>;
    set(path: string, trusted: boolean): ProjectTrustState;
  };
  /** Announce `projects.scan` and `projects.clone` in `host.info`: "find my projects" needs them. */
  find?: boolean;
}

/** Phase 12, #1593: the checkpoints domain's part of the server, each service optional. */
interface CheckpointsServer {
  /** The git snapshots behind `snapshots.list` and `snapshots.files`. */
  snapshots?: Snapshots;
  /** Going back to a turn (`rewind.*`). */
  rewinder?: Rewinder;
  /** `session.fork`. */
  forker?: Forker;
}

/** Phase 22, #1593: the cards' PR watch, each service optional. */
interface PrWatchServer {
  /** Phase 22: the PR watch of the cards. */
  watch?: PrWatch;
  /** Issue #1361: the cards' check loop switch (it reads the watch's checks). */
  checkLoop?: CheckLoopSwitch;
}

/** Phases 9 and #280, #1593: the daemon's own update, each service optional. */
interface UpdatesServer {
  /** Phase 9: the release manifest check behind `host.info.update` and `daemon.update.check`. */
  check?: UpdateChecker;
  /** Phase 9: applies the checked update (`daemon.update.apply`). */
  apply?: DaemonUpdater;
  /** Issue #280: the automatic update (`host.info.autoUpdate`, `host.updates.set`). */
  auto?: {
    status(): AutoUpdateStatus;
    set(auto: boolean): Promise<AutoUpdateStatus>;
  };
}

/** Phase 23, #1593: the telemetry's part of the server, each service optional. */
interface TelemetryServer {
  /** The timing of terminal sessions, from Claude Code's OTLP telemetry. */
  store?: TelemetryStore;
  /** The settings.json opt-in for a plain `claude`. */
  optIn?: TelemetryOptIn;
}

/** Phase 8, #1593: the costs' part of the server, each service optional. */
interface CostsServer {
  /** Estimated costs behind the `costs.*` commands. */
  costs?: Costs;
  /** Budgets behind the `budget.*` commands. */
  budgets?: Budgets;
}

/** Phase 20, #1593: the personas' part of the server, each service optional. */
interface PersonasServer {
  /** The personas behind `personas.*`. */
  store?: Personas;
  /** Applying a persona to an open session, behind `session.applyPersona` and `session.clearPersona`. */
  sessions?: OpenSessionPersonas;
}

/** Issue #100, #1593: the teleport's part of the server, each service optional. */
interface TeleportServer {
  /** The packages of the sessions this host teleports to another. */
  packages?: TeleportPackages;
  /** The packages other hosts send to this one. */
  inbox?: TeleportInbox;
  /** What an import on this host reads (none without a history root). */
  imports?: TeleportImportDeps;
}

/** #1593: the session settings' part of the server, each switch optional. */
interface SessionSettingsServer {
  /** Announce `session.settings` (set mode, set model, slash commands) in `host.info`. */
  commands?: true;
  /** The host's switch for sessions without permission prompts: read for `host.info`, set by `host.bypass`. */
  bypass?: { allowed(): boolean; set(allow: boolean): void | Promise<void> };
  /** Issue #157: how long an idle session may wait before it sleeps; read for `host.info`, set by `host.sleep`. */
  sleep?: { minutes(): number; set(minutes: number): void | Promise<void> };
  /** Issue #1478: the stall watcher: its presence announces the host feature `stall`. */
  stall?: { minutes(): number };
}

/** #1593: the messaging's part of the server (phase 21), each service optional. */
interface MessagingServer {
  /** Messages between sessions (`messages.*`, `messaging.*`). */
  messages?: Messaging;
  /** The one-shot idle notices (`idle.subscribe`). */
  idle?: Idle;
  /** The teams (`teams.*`). */
  teams?: Teams;
}

/** #1593: the Agent setup's part of the server, each service optional. */
interface AgentSetupServer {
  /** Phase 12: the project's CLAUDE.md, agents and skills (`agentcfg.*`). */
  agentcfg?: AgentConfig;
  /** Phase 12: the project's MCP servers (`mcp.*`). */
  mcp?: McpConfig;
  /** Phase 26: the Claude Code plugins (`plugins.*`). */
  plugins?: Plugins;
  /** Phase 26: the project's auto memory (`memory.*`). */
  memory?: ProjectMemory;
  /** What tasks started from templates produced, behind `task.results` (phase 33). */
  tasks?: TaskTracker;
  /** The templates behind `template.list` (phase 33): the built-ins and the host's own files. */
  templates?: () => Promise<LoadedTemplates>;
}

/** #1593: the host's checks (`deps/`), each service optional. */
interface HostChecksServer {
  /** Runs the host's self-check for `doctor.run`. */
  doctor?: (appVersion?: string) => Promise<DoctorResult>;
  /** Checks the host's dependencies for `deps.check`. */
  deps?: () => Promise<DepsResult>;
}

/** Phase 18, #1593: the snippets domain's part of the server, each service optional. */
interface SnippetsServer {
  /** The snippets behind `snippets.*`. */
  library?: Snippets;
  /** The import from the shell history behind `snippets.importHistory`. */
  history?: HistoryImporter;
  /** Using a snippet behind `snippets.render` and `snippets.use`. */
  use?: SnippetUse;
}

/** Phase 15, #1593: the ssh domain's part of the server, each service optional. */
interface SshServer {
  /** The ssh destinos behind `ssh.*`. */
  targets?: SshTargets;
  /** The read-only import of `~/.ssh/config` behind `ssh.import.*`. */
  import?: SshImporter;
  /** The server keys of the ssh destinos behind `ssh.hostkey.*`. */
  hostKeys?: HostKeys;
  /** Opening a ssh destino in a terminal, behind `ssh.connect` and `ssh.test`. */
  connect?: SshConnector;
  /** The ssh password and passphrase requests behind `askpass.*`. */
  askpass?: AskpassBroker;
}

/** Issue #75, #1593: the harness domain's part of the server, each service optional. */
interface HarnessServer {
  /** A project's stack and commands, read from its manifest files, never run. */
  stack?: (path: string) => Promise<HarnessStack>;
  /** What adding harness parts would add, written nowhere. */
  preview?: (
    path: string,
    parts: readonly PreviewPart[],
    template?: TemplateMarkdown | null,
  ) => Promise<HarnessPreview>;
  /** Writes what the preview proposed, when `digests` still match the proposals. */
  apply?: (
    path: string,
    parts: readonly PreviewPart[],
    digests: Readonly<Record<string, string>>,
    options: { reformat: boolean; template?: TemplateMarkdown },
  ) => Promise<HarnessApplied>;
  /** Slice T1: the host's harness templates, shared from projects. */
  templates?: Pick<HarnessTemplates, "export" | "list" | "files" | "remove">;
  /** Slice G1: drafts a CLAUDE.md with the host's model and holds it by its digest. */
  draft?: (path: string) => Promise<HarnessDraft>;
  /** Slice C1: commits what apply wrote (by its digests) on a new branch. */
  commit?: (path: string, digests: Readonly<Record<string, string>>) => Promise<HarnessCommitted>;
}

/** Issue #76, #1593: the knowledge domain's part of the server, each service optional. */
interface KnowledgeServer {
  /** The library of documents of a project, read only. */
  list?: (path: string) => Promise<KnowledgeListResult>;
  /** The index of the project's current documents for a session's system prompt. */
  feed?: (path: string) => Promise<KnowledgeIndexResult>;
  /** Whether sessions in a project are given that index, and the person's switch for it. */
  feedSwitch?: KnowledgeSwitch;
  /** The status of one library document, written into its front matter. */
  status?: (
    path: string,
    file: string,
    status: KnowledgeStatus,
    expectedHash: string,
  ) => Promise<KnowledgeEntry>;
  /** #1039: a new library document from a template, in the project's folder for its kind. */
  create?: (
    path: string,
    kind: KnowledgeKind,
    title: string,
    body?: string,
  ) => Promise<KnowledgeEntry>;
}

export interface ServerOptions {
  manager: SessionManager;
  /** Phase 39: whether OpenCode runs on this host, and its models. */
  opencode?: {
    info: () => OpenCodeInfo;
    models: () => Promise<Array<{ id: string; name: string }>>;
  };
  /** The host's projects: their keys, their trust and "find my projects" (#1593). */
  projects?: ProjectsServer;
  hostName: string;
  bind: string;
  port: number;
  token: string;
  allowedRoots: readonly string[];
  /** Keeps the computer awake while sessions run (issue #163): its status for `host.info`, and the switch for `host.keepAwake`. */
  keepAwake?: { status(): KeepAwakeStatus; set(enabled: boolean): void | Promise<void> };
  /** Issue #1568: the git behind `project.detectProvider` (the real one when absent; a test fakes it). */
  projectGit?: AsyncGitRunner;
  /** Issue #1404: the pause of new card runs, for `host.info` and the near-only `host.pause`. */
  hostPause?: { status(): HostPauseStatus; set(paused: boolean): void | Promise<void> };
  /** Issue #196: the trust of folders and what a project would load; absent, the commands are refused and not announced. */
  /** Who the peer is, for the origin rules; the socket's own address when absent (tests give theirs). */
  peerOf?: (
    req: Request,
    server: { requestIP(req: Request): { address: string } | null },
  ) => string;
  /** #75: the project's Claude Code setup (harness); each part is announced by `host.info` on its own. */
  harness?: HarnessServer;
  /** Issue #79: the open alerts of the repository in a folder, read with `gh`. */
  alerts?: (cwd: string) => Promise<AlertList>;
  /** Issue #76: the project's library of documents; each part is announced by `host.info` on its own. */
  knowledge?: KnowledgeServer;
  /** The allowed folders' services: keeping them, the system folders refused, the picker (#1593). */
  roots?: RootsServer;
  /** The host's self-check and its dependencies (#1593); each service absent is refused and not announced. */
  hostChecks?: HostChecksServer;
  /**
   * #1200: installs this daemon as a service for the next boot or login, refused without confirm;
   * absent (a daemon not run as its stable binary), the command is refused and not announced.
   */
  serviceInstall?: (confirm: boolean) => Promise<ServiceInstallResult>;
  /** Sign-in with GitHub and start from a GitHub project (phase 37): the `github.*` commands. */
  github?: GithubService;
  /** What the agents cost and delivered, per project (phase 36): `roi.summary`. */
  roi?: RoiSummarizer;
  /** Issue #1344: what happened on this host since a time (`activity.since`), read-only and capped. */
  activity?: (since: string, limit: number) => ActivitySinceResult;
  /** Board sync with an external board (phase 38): the `boardsync.*` commands. */
  boardsync?: BoardSyncService;
  /** How `projects.clone` runs git; the real one when absent (tests give theirs). */
  git?: GitRunner;
  /** #1593: the session settings: the commands' announcement and the host's switches. */
  sessionSettings?: SessionSettingsServer;
  /** CIDR ranges allowed to connect; defaults to loopback only. */
  allowedNetworks?: readonly string[];
  pingIntervalMs?: number;
  /** The clock behind the heartbeat (`performance.now()` when absent); a test gives its own. */
  now?: () => number;
  /** Runs `tick` every `everyMs` and returns the function that stops it (a `setInterval` when absent); a test fires it by hand. */
  pingTicker?: (tick: () => void, everyMs: number) => () => void;
  /** Transcript index behind the `history.*` commands. */
  history?: HistoryIndexer;
  /** Projects and cards behind the `project.*`, `board.*` and `card.*` commands. */
  board?: Board;
  /** Phase 40: the AI assistant on this host's `claude`; announced in `host.info` when present. */
  assistant?: AssistantService;
  /** Issue #100, #1593: the teleport between hosts. */
  teleport?: TeleportServer;
  /** The run environment of the cards: the run.yaml and the processes (phase 24). */
  runenv?: { configs: RunConfigs; manager: RunManager };
  /** External sessions and their permission requests (phase 5). */
  central?: Central;
  /** Retention and backups behind the `maintenance.*` commands (phase 7). */
  maintenance?: Maintenance;
  /** The daemon's own log file, behind `logs.tail` and `host.info.logPath` (issue #255). */
  fileLog?: FileLog;
  /** The app's latest releases, behind `releases.list` (issue #125). */
  releases?: ReleaseFeed;
  /** What the host's sessions and terminals cost it, behind `resources.*` (issue #154). */
  resources?: Resources;
  /** What the cards' worktrees take on the disk, behind `worktree.*` (issue #152). */
  worktrees?: Worktrees;
  /** Client protocols accepted, `[min, max]`; `[MIN_PROTOCOL_VERSION, PROTOCOL_VERSION]` by default. */
  protocolRange?: readonly [number, number];
  /** Phase 16: secrets the app hands over for one use (`vault.*`). */
  vault?: Vault;
  /** The cards' PR watch and its check loop switch (phase 22, #1361, #1593). */
  prWatch?: PrWatchServer;
  /** Phase 21: messages between sessions, their idle notices and the teams (#1593). */
  messaging?: MessagingServer;
  /** Phase 21: the standard names of the sessions (`names.list`, and the rename of a session). */
  names?: Names;
  /** Phase 17: actions that use a secret without Claude seeing it (`actions.*`, `vault.watch`). */
  actions?: Actions;
  /** Phase 13: the projects' automations (`automation.*`). */
  automations?: Automations;
  /** Phase 13: issues of the projects (`issues.*`). */
  issues?: Issues;
  /** Phase 13: the projects' automatic approval (`autoapprove.*`). */
  autoApprove?: AutoApprover;
  /** What Claude Code's agents are set up with (phases 12, 26 and 33, #1593). */
  agentSetup?: AgentSetupServer;
  /** Phase 12, #1593: the turns' snapshots, the rewind and the fork. */
  checkpoints?: CheckpointsServer;
  /** The daemon's own update: its check, its apply and the automatic update (#1593). */
  updates?: UpdatesServer;
  /** Called after acking `daemon.shutdown`; without it the command is refused. */
  onShutdown?: () => void;
  /** What `host.info` announces; derived from what this daemon has when absent. */
  features?: string[];
  /** The host's plan quota (phase 7, #1593). */
  quota?: QuotaServer;
  /** Issue #1343: the memory hold for new cards, `resources.pauseAt`, read and changed from the app. */
  memoryPause?: {
    pauseAt(): number | null;
    /** Issue #1414: the gate holds new cards now (its margin; never without a reading). */
    holding?(): boolean;
    set(pauseAt: number | null): void | Promise<void>;
  };
  /** The Claude account behind `account.*` (phase 34). */
  account?: Account;
  /** Usage by day and project behind `usage.summary` (phase 7). */
  usage?: UsageLedger;
  /** The estimated costs and their budgets (phase 8, #1593). */
  costs?: CostsServer;
  /** The telemetry's timings and its opt-in (phase 23, #1593). */
  telemetry?: TelemetryServer;
  /** Phase 25: the trace of a session, built from its transcript and its subagents'. */
  trace?: TraceService;
  /** Phase 30: the short summary of a session. */
  summary?: SummaryService;
  /** Phase 30: posts the webhooks the app sends. */
  webhook?: WebhookSender;
  /** Phase 27: Claude Code's background sessions, through its own CLI. */
  bg?: BgService;
  /** The ssh destinos and what the server offers of them (phase 15, #1593). */
  ssh?: SshServer;
  /** Where the server writes what it refuses and why a connection closed (never a secret). */
  log?: (message: string) => void;
  /** The snippets and what the server offers of them (phase 18, #1593). */
  snippets?: SnippetsServer;
  /** The personas and applying one to an open session (phase 20, #1593). */
  personas?: PersonasServer;
  /** The review of sessions and cards and their files (phase 11, #1593). */
  review?: ReviewServer;
  /** The host's terminals behind `terminal.*` (phase 14). */
  terminals?: TerminalManager;
  /** The host's default mode and lock (phase 33); changed by `ui.set`, which `onUiSettings` keeps. */
  ui?: UiSettings;
  onUiSettings?: (ui: UiSettings) => void | Promise<void>;
  /** Called after `terminal.settings` changes whether terminals are on (the config keeps it). */
  onTerminalSettings?: (enabled: boolean) => void | Promise<void>;
  /** The `claude` executable reported by `host.info`; absent with the fake runtime. */
  claude?: { path: string | null; version(): Promise<string | null> };
  /** What "Abrir no terminal" needs from `host.info` (phase 8). */
  terminal?: { flightdeckdPath: string | null; wslDistro: string | null };
}

export interface RunningServer {
  url: string;
  port: number;
  /** Switches to a new token and closes every connection authenticated with the old one. */
  setToken(token: string): void;
  stop(): Promise<void>;
}

export { tokenMatches };

export function startServer(opts: ServerOptions): RunningServer {
  const { manager } = opts;

  /** The daemon closes a connection and says why, for the close log (#1532). */
  const closeBy = (ws: Socket, cause: string, code: number, reason: string) => {
    ws.data.closedBy = cause;
    ws.close(code, reason);
  };
  const unauthorized = (ws: Socket) =>
    closeBy(ws, "unauthorized", CLOSE_UNAUTHORIZED, "unauthorized");
  const authed = new Set<Socket>();
  /** What every handler shares (issue #248), and one command's view of its socket. */
  const context = serverContext(opts);
  const call = (ws: Socket): Call => ({ ws, send: (frame) => send(ws, frame), server: context });
  let currentToken = opts.token;
  let pingSeq = 0;
  let connSeq = 0;

  const pingEveryMs = opts.pingIntervalMs ?? PING_INTERVAL_MS;
  const now = opts.now ?? (() => performance.now());
  const pingTicker =
    opts.pingTicker ??
    ((tick: () => void, everyMs: number) => {
      const timer = setInterval(tick, everyMs);
      return () => clearInterval(timer);
    });
  const stopHeartbeat = pingTicker(() => {
    for (const ws of authed) {
      const silentMs = now() - ws.data.lastFrameAt;
      if (
        ws.data.pendingPings.size >= MAX_MISSED_PINGS &&
        silentMs >= MAX_MISSED_PINGS * pingEveryMs
      ) {
        closeBy(ws, "heartbeat", CLOSE_HEARTBEAT, "heartbeat timeout");
        continue;
      }
      const id = String(++pingSeq);
      ws.data.pendingPings.set(id, now());
      const { lastRttMs } = ws.data;
      send(ws, { type: "ping", id, ...(lastRttMs !== undefined ? { lastRttMs } : {}) });
    }
  }, pingEveryMs);

  /** The daemon measures the round trip: the app cannot time a ping it did not send. */
  function onPong(ws: Socket, frame: unknown): void {
    const pong = Pong.safeParse(frame);
    const sentAt = pong.success ? ws.data.pendingPings.get(pong.data.id) : undefined;
    if (sentAt === undefined) return;
    ws.data.lastRttMs = Math.round(now() - sentAt);
    ws.data.lastPongAt = now();
    ws.data.pendingPings.clear();
  }

  function onHello(ws: Socket, frame: unknown): void {
    const parsed = Command.safeParse(frame);
    if (!parsed.success || parsed.data.type !== "hello") {
      unauthorized(ws);
      return;
    }
    if (!tokenMatches(currentToken, parsed.data.payload.token)) {
      unauthorized(ws);
      return;
    }
    // Clients before phase 7 send no version: they speak protocol 1.
    const version = parsed.data.payload.protocolVersion ?? 1;
    const [min, max] = opts.protocolRange ?? [MIN_PROTOCOL_VERSION, PROTOCOL_VERSION];
    if (version < min || version > max) {
      // The connection stays open and unauthenticated: a compatible hello may follow.
      const message = `protocolo ${version} do cliente fora do intervalo do daemon [${min}, ${max}]`;
      ackError(ws, parsed.data.id, "protocol_incompatible", message);
      return;
    }
    ws.data.authed = true;
    ws.data.client = parsed.data.payload.client;
    authed.add(ws);
    const data: CommandResults["hello"] = {
      hostName: opts.hostName,
      daemonVersion: DAEMON_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      allowedRoots: [...opts.allowedRoots],
      // #1191: `sessions.watch` can carry the current summaries in its ack.
      features: ["watch.snapshot"],
    };
    send(ws, { type: "ack", id: parsed.data.id, ok: true, data });
  }

  async function dispatch(ws: Socket, command: Command): Promise<void> {
    // The messaging service lists every endpoint with its project key, read synchronously.
    if (command.type.startsWith("messages.") || command.type.startsWith("teams.")) {
      await context.warmKeys([
        ...manager.list().map((s) => s.cwd),
        ...(opts.central?.external.list() ?? []).flatMap((s) => (s.cwd ? [s.cwd] : [])),
      ]);
    }

    // Issue #248: a command whose domain has moved runs its handler; the rest are still cases here.
    const handler = HANDLERS[command.type] as Handler<CommandType> | undefined;
    if (handler) return runHandler(handler, command as never, call(ws));

    switch (command.type) {
      case "hello":
        return onHello(ws, command);
    }
  }

  async function onCommand(ws: Socket, frame: unknown): Promise<void> {
    const header = CommandHeader.safeParse(frame);
    const id = header.success ? header.data.id : "";
    const parsed = Command.safeParse(frame);
    if (!parsed.success) {
      const field = (parsed.error.issues[0]?.path ?? []).filter((p) => p !== "payload").join(".");
      const command = header.success ? header.data.type : "";
      return ackError(
        ws,
        id,
        "bad_request",
        z.prettifyError(parsed.error),
        new FlightdeckError("bad_request", "", "request_invalid", { command, field }),
      );
    }
    try {
      await dispatch(ws, parsed.data);
    } catch (error) {
      if (error instanceof FlightdeckError)
        return ackError(ws, id, error.code, error.message, error);
      console.error(`[flightdeckd] erro em ${parsed.data.type}:`, error);
      ackError(ws, id, "internal", "internal daemon error");
    }
  }

  const server = Bun.serve<Connection>({
    hostname: opts.bind,
    port: opts.port,
    fetch(req, srv) {
      // Origin filter before anything else, on every route, before any upgrade.
      const origin = opts.peerOf ? opts.peerOf(req, srv) : (srv.requestIP(req)?.address ?? "");
      if (!ipInNetworks(origin, opts.allowedNetworks ?? DEFAULT_ALLOWED_NETWORKS)) {
        // Its own address, so a person told "refused" can add the right network (the doctor reads it).
        return new Response(`forbidden: ${origin}`, { status: 403 });
      }
      const url = new URL(req.url);
      if (url.pathname === WS_PATH) {
        const upgraded = srv.upgrade(req, {
          data: {
            authed: false,
            origin,
            subscriptions: new Map(),
            coalescers: new Set(),
            pendingPings: new Map(),
            lastFrameAt: now(),
            id: ++connSeq,
            connectedAt: now(),
            changeWatchers: new Map(),
          },
        });
        if (upgraded) return undefined;
        return new Response("WebSocket esperado", { status: 426 });
      }
      if (url.pathname === "/health") return Response.json({ ok: true });
      return new Response("not found", { status: 404 });
    },
    websocket: {
      drain: drainAll,
      message(ws, raw) {
        ws.data.lastFrameAt = now();
        let frame: unknown;
        try {
          frame = decode(raw);
        } catch {
          if (!ws.data.authed) return unauthorized(ws);
          return ackError(ws, "", "bad_request", "invalid JSON");
        }
        // Before hello every frame, a pong included, goes to onHello (non-hello closes 4401).
        if (!ws.data.authed) return onHello(ws, frame);
        if ((frame as { type?: unknown } | null)?.type === "pong") return onPong(ws, frame);
        void onCommand(ws, frame);
      },
      close(ws, code, reason) {
        authed.delete(ws);
        const at = now();
        opts.log?.(
          closeLine(
            {
              id: ws.data.id,
              client: ws.data.client ?? null,
              code,
              reason,
              byDaemon: ws.data.closedBy ?? null,
              upMs: at - ws.data.connectedAt,
              silentMs: at - ws.data.lastFrameAt,
              pongAgoMs: ws.data.lastPongAt === undefined ? null : at - ws.data.lastPongAt,
            },
            currentToken,
          ),
        );
        ws.data.unwatch?.();
        ws.data.unwatchHistory?.();
        ws.data.unwatchBoard?.();
        ws.data.unwatchExternal?.();
        ws.data.unwatchRuns?.();
        ws.data.unwatchRunEnv?.();
        ws.data.unwatchQuota?.();
        ws.data.unwatchAccount?.();
        ws.data.unwatchAskpass?.();
        ws.data.unwatchBudgets?.();
        if (ws.data.terminalSink) opts.terminals?.detachAll(ws.data.terminalSink);
        for (const stop of ws.data.changeWatchers.values()) stop();
        ws.data.changeWatchers.clear();
        ws.data.unwatchVault?.();
        ws.data.unwatchMessages?.();
        ws.data.unwatchTeams?.();
        ws.data.unwatchPrs?.();
        ws.data.search?.abort();
        for (const unsubscribe of ws.data.subscriptions.values()) unsubscribe();
        ws.data.subscriptions.clear();
      },
    },
  });

  const port = server.port ?? opts.port;
  const host = opts.bind.includes(":") ? `[${opts.bind}]` : opts.bind;
  return {
    url: `ws://${host}:${port}${WS_PATH}`,
    port,
    setToken(token) {
      if (token === currentToken) return;
      currentToken = token;
      // Only one token is valid at a time, so every authenticated client used the old one.
      for (const ws of authed)
        closeBy(ws, "token rotated", CLOSE_UNAUTHORIZED, "token rotacionado");
    },
    stop: () => {
      stopHeartbeat();
      opts.agentSetup?.plugins?.close();
      return server.stop(true);
    },
  };
}
