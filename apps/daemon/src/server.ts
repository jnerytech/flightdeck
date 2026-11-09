import {
  ASSISTANT_FEATURE,
  type AutoUpdateStatus,
  CLOSE_HEARTBEAT,
  CLOSE_UNAUTHORIZED,
  Command,
  CommandHeader,
  type CommandResults,
  type CommandType,
  type DepsResult,
  type DoctorResult,
  type ExternalSession,
  type ExternalStatus,
  FEATURE_HOLD_PROOF,
  FEATURE_RESUME_OFFER,
  FEATURE_SERVICE_INSTALL,
  type HarnessApplied,
  type HarnessCommitted,
  type HarnessDraft,
  type HarnessPreview,
  type HarnessStack,
  type HostRuntime,
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
  type SessionLine,
  type UiSettings,
  WS_PATH,
} from "@flightdeck/protocol";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import type { Account } from "./account/account.ts";
import type { Actions } from "./actions/actions.ts";
import type { AgentConfig } from "./agentcfg/files.ts";
import type { McpConfig } from "./agentcfg/mcp.ts";
import type { AssistantService } from "./assistant/service.ts";
import type { Automations } from "./automations/automations.ts";
import type { BgService } from "./bg/service.ts";
import type { Board } from "./board/board.ts";
import type { BoardSyncService } from "./boardsync/service.ts";
import { type Central, messageExternal } from "./central/central.ts";
import type { Forker } from "./checkpoints/fork.ts";
import type { Rewinder } from "./checkpoints/rewind.ts";
import type { Snapshots } from "./checkpoints/snapshots.ts";
import type { Budgets } from "./costs/budgets.ts";
import type { Costs } from "./costs/costs.ts";
import { statuslineData } from "./costs/statusline.ts";
import { drainAll } from "./delta-coalescer.ts";
import { FlightdeckError, featureOff } from "./errors.ts";
import type { AlertList } from "./github/alerts.ts";
import type { GithubService } from "./github/service.ts";
import type { PreviewPart } from "./harness/preview.ts";
import type { HarnessTemplates, TemplateMarkdown } from "./harness/templates-store.ts";
import type { HistoryIndexer } from "./history/indexer.ts";
import type { Issues } from "./issues/issues.ts";
import type { KnowledgeSwitch } from "./knowledge/switch.ts";
import type { FileLog } from "./logs/file-log.ts";
import { logPathFor, tailForOrigin } from "./logs/serve.ts";
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
import type { GitRunner } from "./project-find.ts";
import type { QuotaHistory } from "./quota/history.ts";
import type { Quota } from "./quota/quota.ts";
import type { UsageLedger } from "./quota/usage.ts";
import { localDay } from "./quota/usage.ts";
import type { ReleaseFeed } from "./releases/releases.ts";
import type { Resources } from "./resources/resources.ts";
import type { Changes } from "./review/changes.ts";
import type { ReviewComments } from "./review/comments.ts";
import type { ReviewFiles } from "./review/files.ts";
import type { SessionCommits } from "./review/session-commit.ts";
import type { SessionFiles } from "./review/session-files.ts";
import type { SessionPrs } from "./review/session-pr.ts";
import { type RoiSummarizer, roiPeriod } from "./roi/summary.ts";
import { addAllowedRoot, type PlatformInfo } from "./roots.ts";
import type { RunConfigs } from "./runenv/config.ts";
import type { RunManager } from "./runenv/manager.ts";
import type { OpenCodeInfo } from "./runtime/opencode-discovery.ts";
import { serverContext } from "./server/context.ts";
import { type Call, type Handler, runHandler } from "./server/dispatch.ts";
import { need } from "./server/gates.ts";
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
import { requireVaultTransport, type Vault } from "./vault/vault.ts";
import type { PrWatch } from "./watch/service.ts";
import type { WebhookSender } from "./webhook/sender.ts";
import type { Worktrees } from "./worktrees/worktrees.ts";

export const DAEMON_VERSION: string = pkg.version;

/**
 * How often the daemon pings each authenticated client. A client is closed after
 * `MAX_MISSED_PINGS` unanswered pings AND that many intervals without any frame from it: a page
 * starved of CPU may be late with its pongs, but anything it sends shows it is there.
 */
export const PING_INTERVAL_MS = 15_000;
const MAX_MISSED_PINGS = 4;

/** What `host.info` says about OpenCode: no executable fingerprint, no finding paths. */
function hostRuntime(info: OpenCodeInfo): HostRuntime {
  return {
    kind: "opencode",
    available: info.available,
    ...(info.path ? { path: info.path } : {}),
    ...(info.version ? { version: info.version } : {}),
    ...(info.verified !== undefined ? { verified: info.verified } : {}),
    ...(info.reason ? { reason: info.reason } : {}),
  };
}

export interface ServerOptions {
  manager: SessionManager;
  /** Phase 39: whether OpenCode runs on this host, and its models. */
  opencode?: {
    info: () => OpenCodeInfo;
    models: () => Promise<Array<{ id: string; name: string }>>;
  };
  /** Looks up the project of a folder before a session is created in it (without blocking). */
  warmProjectKey?: (cwd: string) => Promise<unknown>;
  /** The project key of a folder, asked without blocking: `history.list` filters by it. */
  projectKeyOf?: (cwd: string) => Promise<string>;
  hostName: string;
  bind: string;
  port: number;
  token: string;
  allowedRoots: readonly string[];
  /** The host's switch for sessions without permission prompts: read for `host.info`, set by `host.bypass`. */
  bypass?: { allowed(): boolean; set(allow: boolean): void | Promise<void> };
  /** Issue #157: how long an idle session may wait before it sleeps; read for `host.info`, set by `host.sleep`. */
  sleep?: { minutes(): number; set(minutes: number): void | Promise<void> };
  /** Keeps the computer awake while sessions run (issue #163): its status for `host.info`, and the switch for `host.keepAwake`. */
  keepAwake?: { status(): KeepAwakeStatus; set(enabled: boolean): void | Promise<void> };
  /** Issue #196: the trust of folders and what a project would load; absent, the commands are refused and not announced. */
  /** Who the peer is, for the origin rules; the socket's own address when absent (tests give theirs). */
  peerOf?: (
    req: Request,
    server: { requestIP(req: Request): { address: string } | null },
  ) => string;
  /** #75: a project's stack and commands, read from its manifest files, never run. */
  harnessStack?: (path: string) => Promise<HarnessStack>;
  /** Issue #79: the open alerts of the repository in a folder, read with `gh`. */
  alerts?: (cwd: string) => Promise<AlertList>;
  /** Issue #76: the library of documents of a project, read only. */
  knowledge?: (path: string) => Promise<KnowledgeListResult>;
  /** #76: the index of the project's current documents for a session's system prompt. */
  knowledgeFeed?: (path: string) => Promise<KnowledgeIndexResult>;
  /** #76: whether sessions in a project are given that index, and the person's switch for it. */
  knowledgeFeedSwitch?: KnowledgeSwitch;
  /** #76: the status of one library document, written into its front matter. */
  knowledgeStatus?: (
    path: string,
    file: string,
    status: KnowledgeStatus,
    expectedHash: string,
  ) => Promise<KnowledgeEntry>;
  /** #1039: a new library document from a template, in the project's folder for its kind. */
  knowledgeCreate?: (
    path: string,
    kind: KnowledgeKind,
    title: string,
    body?: string,
  ) => Promise<KnowledgeEntry>;
  /** #75: what adding harness parts would add, written nowhere. */
  harnessPreview?: (
    path: string,
    parts: readonly PreviewPart[],
    template?: TemplateMarkdown | null,
  ) => Promise<HarnessPreview>;
  /** #75: writes what the preview proposed, when `digests` still match the proposals. */
  harnessApply?: (
    path: string,
    parts: readonly PreviewPart[],
    digests: Readonly<Record<string, string>>,
    options: { reformat: boolean; template?: TemplateMarkdown },
  ) => Promise<HarnessApplied>;
  /** #75, slice T1: the host's harness templates, shared from projects. */
  harnessTemplates?: Pick<HarnessTemplates, "export" | "list" | "files" | "remove">;
  /** #75, slice G1: drafts a CLAUDE.md with the host's model and holds it by its digest. */
  harnessDraft?: (path: string) => Promise<HarnessDraft>;
  /** #75, slice C1: commits what apply wrote (by its digests) on a new branch. */
  harnessCommit?: (
    path: string,
    digests: Readonly<Record<string, string>>,
  ) => Promise<HarnessCommitted>;
  projectTrust?: {
    /** Reads what `state` and `set` compare with (the roots' real paths) before they answer. */
    refresh(): Promise<void>;
    state(paths: string[]): ProjectTrustState[];
    inspect(path: string): Promise<ProjectLoad>;
    set(path: string, trusted: boolean): ProjectTrustState;
  };
  /** Keeps the allowed folders in the config file after `roots.add`. */
  persistRoots?: (roots: readonly string[]) => void | Promise<void>;
  /** What decides the system folders `roots.add` refuses; the process's own when absent (tests give theirs). */
  rootsPlatform?: PlatformInfo;
  /** Announce `fs.dirs` in `host.info`: the app offers its folder picker only to such a host. */
  fsDirs?: boolean;
  /** Runs the host's self-check for `doctor.run`; absent, the command is refused and not announced. */
  doctor?: (appVersion?: string) => Promise<DoctorResult>;
  /**
   * #1200: installs this daemon as a service for the next boot or login, refused without confirm;
   * absent (a daemon not run as its stable binary), the command is refused and not announced.
   */
  serviceInstall?: (confirm: boolean) => Promise<ServiceInstallResult>;
  /** Checks the host's dependencies for `deps.check`; absent, the command is refused and not announced. */
  deps?: () => Promise<DepsResult>;
  /** Sign-in with GitHub and start from a GitHub project (phase 37): the `github.*` commands. */
  github?: GithubService;
  /** What the agents cost and delivered, per project (phase 36): `roi.summary`. */
  roi?: RoiSummarizer;
  /** Board sync with an external board (phase 38): the `boardsync.*` commands. */
  boardsync?: BoardSyncService;
  /** Announce `projects.scan` and `projects.clone` in `host.info`: "find my projects" needs them. */
  findProjects?: boolean;
  /** How `projects.clone` runs git; the real one when absent (tests give theirs). */
  git?: GitRunner;
  /** Announce `session.settings` (set mode, set model, slash commands) in `host.info`. */
  sessionSettings?: boolean;
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
  /** Issue #100: the packages of the sessions this host teleports to another. */
  teleport?: TeleportPackages;
  /** Issue #100: the packages other hosts send to this one. */
  teleportInbox?: TeleportInbox;
  /** Issue #100: what an import on this host reads. */
  teleportImport?: TeleportImportDeps;
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
  /** Phase 21: the teams (`teams.*`). */
  teams?: Teams;
  /** Phase 22: the PR watch of the cards. */
  watch?: PrWatch;
  /** Phase 21: messages between sessions (`messages.*`, `messaging.*`). */
  messaging?: Messaging;
  /** Phase 21: the standard names of the sessions (`names.list`, and the rename of a session). */
  names?: Names;
  /** Phase 21: the one-shot idle notices (`idle.subscribe`). */
  idle?: Idle;
  /** Phase 17: actions that use a secret without Claude seeing it (`actions.*`, `vault.watch`). */
  actions?: Actions;
  /** Phase 13: the projects' automations (`automation.*`). */
  automations?: Automations;
  /** Phase 13: issues of the projects (`issues.*`). */
  issues?: Issues;
  /** Phase 13: the projects' automatic approval (`autoapprove.*`). */
  autoApprove?: AutoApprover;
  /** Phase 12: the project's CLAUDE.md, agents and skills (`agentcfg.*`). */
  agentcfg?: AgentConfig;
  /** Phase 26: the project's auto memory (`memory.*`). */
  memory?: ProjectMemory;
  /** Phase 26: the Claude Code plugins (`plugins.*`). */
  plugins?: Plugins;
  /** Phase 12: the project's MCP servers (`mcp.*`). */
  mcp?: McpConfig;
  /** Phase 12: `session.fork`. */
  forker?: Forker;
  /** Phase 12: going back to a turn (`rewind.*`). */
  rewinder?: Rewinder;
  /** Phase 12: the git snapshots behind `snapshots.list`. */
  snapshots?: Snapshots;
  /** Phase 9: applies the checked update (`daemon.update.apply`). */
  updater?: DaemonUpdater;
  /** Phase 9: the release manifest check behind `host.info.update`. */
  updates?: UpdateChecker;
  /** Issue #280: the automatic update (`host.info.autoUpdate`, `host.updates.set`). */
  autoUpdate?: {
    status(): AutoUpdateStatus;
    set(auto: boolean): Promise<AutoUpdateStatus>;
  };
  /** Called after acking `daemon.shutdown`; without it the command is refused. */
  onShutdown?: () => void;
  /** What `host.info` announces; derived from what this daemon has when absent. */
  features?: string[];
  /** The host's plan quota behind `quota.*` (phase 7). */
  quota?: Quota;
  /** Changes the guard "new cards wait from N%" (issue #1218): the config file first, then the running `Quota`. */
  quotaPause?: { set(pauseAt: number | null): void | Promise<void> };
  /** Issue #1343: the memory hold for new cards, `resources.pauseAt`, read and changed from the app. */
  memoryPause?: { pauseAt(): number | null; set(pauseAt: number | null): void | Promise<void> };
  /** The Claude account behind `account.*` (phase 34). */
  account?: Account;
  /** Usage by day and project behind `usage.summary` (phase 7). */
  usage?: UsageLedger;
  /** Estimated costs behind the `costs.*` commands (phase 8). */
  costs?: Costs;
  /** Phase 23: the timing of terminal sessions, from Claude Code's OTLP telemetry. */
  telemetry?: TelemetryStore;
  /** The settings.json opt-in for a plain `claude` (phase 23). */
  telemetryOptIn?: TelemetryOptIn;
  /** Phase 25: the trace of a session, built from its transcript and its subagents'. */
  trace?: TraceService;
  /** Phase 30: the short summary of a session. */
  summary?: SummaryService;
  /** Phase 30: posts the webhooks the app sends. */
  webhook?: WebhookSender;
  /** Phase 27: Claude Code's background sessions, through its own CLI. */
  bg?: BgService;
  /** Budgets behind the `budget.*` commands (phase 8). */
  budgets?: Budgets;
  /** The quota's samples behind `quota.history` (phase 8). */
  quotaHistory?: QuotaHistory;
  /** The diff of sessions and cards behind `changes.*` (phase 11). */
  changes?: Changes;
  /** #1133: a plain session's files committed on a new branch in its own checkout. */
  sessionCommits?: SessionCommits;
  /** #1133: a plain session's branch pushed and its PR opened. */
  sessionPrs?: SessionPrs;
  /** The ssh destinos behind `ssh.*` (phase 15). */
  ssh?: SshTargets;
  /** The read-only import of `~/.ssh/config` behind `ssh.import.*` (phase 15). */
  sshImport?: SshImporter;
  /** The server keys of the ssh destinos behind `ssh.hostkey.*` (phase 15). */
  sshHostKeys?: HostKeys;
  /** Opening a ssh destino in a terminal, behind `ssh.connect` and `ssh.test` (phase 15). */
  sshConnect?: SshConnector;
  /** Where the server writes what it refuses (never a secret). */
  log?: (message: string) => void;
  /** The ssh password and passphrase requests behind `askpass.*` (phase 15). */
  askpass?: AskpassBroker;
  /** The snippets behind `snippets.*` (phase 18). */
  snippets?: Snippets;
  /** The import from the shell history behind `snippets.importHistory` (phase 18). */
  snippetHistory?: HistoryImporter;
  /** Using a snippet behind `snippets.render` and `snippets.use` (phase 18). */
  snippetUse?: SnippetUse;
  /** The personas behind `personas.*` (phase 20). */
  personas?: Personas;
  /** Applying a persona to an open session, behind `session.applyPersona` and `session.clearPersona` (phase 20). */
  personaSessions?: OpenSessionPersonas;
  /** Inline comments behind `review.*` (phase 11). */
  review?: ReviewComments;
  /** Revert and edit behind `changes.revert`, `changes.undoRevert` and `file.*` (phase 11). */
  files?: ReviewFiles;
  /** Which session wrote which file, behind `files.sessions` and `session.files` (phase 11). */
  sessionFiles?: SessionFiles;
  /** The host's terminals behind `terminal.*` (phase 14). */
  terminals?: TerminalManager;
  /** The templates behind `template.list` (phase 33): the built-ins and the host's own files. */
  templates?: () => Promise<LoadedTemplates>;
  /** What tasks started from templates produced, behind `task.results` (phase 33). */
  tasks?: TaskTracker;
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

const EXTERNAL_LINE: Record<ExternalStatus, SessionLine["state"]> = {
  running: "running",
  awaiting_permission: "waiting",
  idle: "idle",
  unknown: "idle",
  ended: "ended",
};

/** The names a feature adds when the daemon has it. */
const when = (has: unknown, ...names: string[]): string[] => (has ? names : []);

/** What this daemon has, as `host.info` announces it; the app hides what is missing. */
function featuresOf(opts: ServerOptions): string[] {
  return [
    // A high-risk permission allow needs `held: true` (issue #251).
    FEATURE_HOLD_PROOF,
    // The sessions a restart interrupted can be listed (`session.interrupted`, issue #150).
    FEATURE_RESUME_OFFER,
    // The folder picker of the app browses the host's folders with `fs.dirs`.
    ...when(opts.fsDirs, "fs.dirs", "fs.files"),
    // A live managed session takes a new permission mode and model, and announces its slash commands.
    ...when(opts.sessionSettings, "session.settings", "session.effort"),
    // A message may carry images (`session.send` with `images`).
    "session.images",
    ...when(opts.doctor, "doctor.run"),
    ...when(opts.serviceInstall, FEATURE_SERVICE_INSTALL),
    ...when(opts.keepAwake, "keepAwake"),
    ...when(opts.quotaPause, "quotaPause"),
    ...when(opts.memoryPause, "memoryPause"),
    // Budgets can be a share of a plan quota window (issue #1248).
    ...when(opts.budgets?.opts.quota, "quotaBudgets"),
    ...when(opts.deps, "depsCheck"),
    ...when(opts.projectTrust, "projectTrust"),
    ...when(opts.harnessStack, "harnessStack"),
    ...when(opts.alerts, "alerts"),
    // Issue #76: the project's library of documents, with their lifecycle status.
    ...when(opts.knowledge, "knowledge"),
    ...when(opts.knowledgeFeedSwitch, "knowledgeFeed"),
    ...when(opts.knowledgeStatus, "knowledgeStatus"),
    ...when(opts.knowledgeCreate, "knowledgeCreate"),
    ...when(opts.harnessPreview, "harnessPreview"),
    ...when(opts.harnessApply, "harnessApply"),
    ...when(opts.harnessCommit, "harnessCommit"),
    ...when(opts.harnessDraft, "harnessDraft"),
    ...when(opts.harnessTemplates, "harnessTemplates"),
    ...when(opts.findProjects, "projects.scan", "projects.clone"),
    ...when(opts.github, "github"),
    ...when(opts.boardsync, "boardsync"),
    ...when(opts.roi, "roi"),
    ...when(opts.central, "central"),
    ...when(opts.board, "workflows"),
    // Issue #1221: a template committed on a new branch and opened as a PR.
    ...when(opts.board, "workflowTemplateAdd"),
    // Phase 24: the run.yaml of a card and its processes.
    ...when(opts.runenv && opts.board, "runenv"),
    ...when(opts.maintenance, "maintenance"),
    ...when(opts.fileLog, "logs"),
    ...when(opts.releases, "releases"),
    ...when(opts.resources, "resources"),
    ...when(opts.worktrees, "worktrees"),
    ...when(opts.quota, "quota"),
    ...when(opts.account, "account"),
    // Project rules live in the board's projects.
    ...when(opts.board, "rules"),
    ...when(opts.costs, "costs"),
    ...when(opts.telemetry, "telemetry"),
    ...when(opts.trace, "trace"),
    ...when(opts.summary, "summary"),
    ...when(opts.webhook, "webhook"),
    ...when(opts.bg, "bg"),
    ...when(opts.changes, "review"),
    // Issue #506: the file explorer lists the folders of a session's repository.
    ...when(opts.files, "file.list"),
    // Issue #797: and searches the whole repository, by name or by content.
    ...when(opts.files, "file.search"),
    // Issue #606: a stored tool call opens to its input and result, read from its transcript.
    ...when(opts.history, "history.tool"),
    // Phase 12: the timeline's snapshots, rewind and fork; the agent's MCP, CLAUDE.md, agents and skills.
    ...when(opts.snapshots && opts.rewinder && opts.forker, "checkpoints"),
    ...when(opts.agentcfg && opts.mcp, "agentcfg"),
    ...when(opts.memory, "memory"),
    ...when(opts.plugins, "plugins"),
    // Phase 13: the arena is the board's; issues and automations are services of their own.
    ...when(opts.board, "arena"),
    // Phase 31: card dependencies are the board's.
    ...when(opts.board, "deps"),
    // Issue #76: a card pins library documents; the app offers the picker.
    ...when(opts.board, "cardPins"),
    // Issue #1201: a project's card templates; New card offers them.
    ...when(opts.board, "cardTemplates"),
    // Issue #1196: a card merges its open PR (`card.pr.merge`).
    ...when(opts.board, "cardPrMerge"),
    ...when(opts.issues, "issues"),
    ...when(opts.automations, "automation"),
    ...when(opts.autoApprove, "autoapprove"),
    // Phase 15: the app shows Conexões for hosts that keep ssh destinos.
    ...when(opts.ssh, "ssh"),
    // Phase 17: the actions that use a vault secret without Claude seeing it.
    ...when(opts.actions, "actions"),
    // Phase 18: saved commands and prompts of the host and its projects.
    ...when(opts.snippets, "snippets"),
    // Phase 20: the engineering personas of the host and its projects.
    ...when(opts.personas, "personas"),
    // Phase 21: messages between sessions, teams and the standard session names.
    ...when(opts.messaging, "messaging"),
    // Issue #93: `teams.create` and `addMember` take a permission mode per member.
    ...when(opts.teams, "teams", "teams.permissions"),
    // Phase 22: watching a card's PR and fixing it.
    ...when(opts.watch, "watch"),
    // Issue #77: a card's watch takes more rounds.
    ...when(opts.watch, "watch.extend"),
    ...when(opts.watch, "watch.resolveHeld"),
    ...when(opts.names, "names"),
  ];
}

export function startServer(opts: ServerOptions): RunningServer {
  const { manager } = opts;

  const unauthorized = (ws: Socket) => ws.close(CLOSE_UNAUTHORIZED, "unauthorized");
  const authed = new Set<Socket>();
  /** What every handler shares (issue #248), and one command's view of its socket. */
  const context = serverContext(opts);
  const call = (ws: Socket): Call => ({ ws, send: (frame) => send(ws, frame), server: context });
  let currentToken = opts.token;
  const startedAt = Date.now();
  const features = featuresOf(opts);
  let pingSeq = 0;

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
        ws.close(CLOSE_HEARTBEAT, "heartbeat timeout");
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

  function central() {
    return need(opts, "central");
  }

  function roi(): RoiSummarizer {
    return need(opts, "roi");
  }

  function names(): Names {
    return need(opts, "names");
  }

  function idle(): Idle {
    return need(opts, "idle");
  }

  function issues(): Issues {
    return need(opts, "issues");
  }

  /** `host.info.update` once the daemon has checked its manifest. */
  function updateStatus() {
    const update = opts.updates?.status();
    return update ? { update } : {};
  }

  /** An external session as the lists and `external.updated` send it: with its line and name. */
  function externalListed(s: ExternalSession): ExternalSession {
    const waiting = opts.central?.permissions
      .open()
      .find((frame) => frame.claudeSessionId === s.claudeSessionId);
    const summary = context.line(s.claudeSessionId, {
      state: EXTERNAL_LINE[s.status],
      waitingTool: waiting?.toolName ?? null,
      since: s.lastEventAt,
    });
    const meta = opts.central?.meta.get(s.claudeSessionId);
    return { ...s, ...(summary ? { summary } : {}), ...(meta ? { meta } : {}) };
  }

  function fileLog(): FileLog {
    return need(opts, "fileLog");
  }

  function releases(): ReleaseFeed {
    return need(opts, "releases");
  }

  function resources(): Resources {
    return need(opts, "resources");
  }

  function worktrees(): Worktrees {
    return need(opts, "worktrees");
  }

  function board(): Board {
    return need(opts, "board");
  }

  function assistant(): AssistantService {
    if (!opts.assistant) throw featureOff("assistant");
    return opts.assistant;
  }

  async function dispatch(ws: Socket, command: Command): Promise<void> {
    const ok = <T extends CommandType>(_type: T, data?: CommandResults[T]) =>
      send(ws, { type: "ack", id: command.id, ok: true, ...(data !== undefined ? { data } : {}) });

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
      case "external.message": {
        const { claudeSessionId, text } = command.payload;
        const hub = central();
        if (!hub.external.get(claudeSessionId)) {
          throw new FlightdeckError(
            "not_found",
            `session ${claudeSessionId} does not exist`,
            "session_not_found",
            { id: claudeSessionId },
          );
        }
        if (!messageExternal(hub, claudeSessionId, text)) {
          throw new FlightdeckError(
            "invalid_state",
            "session has no channel: only sessions opened with flightdeckd claude receive messages",
            "external_no_channel",
          );
        }
        return ok(command.type);
      }
      case "logs.tail":
        return ok(
          command.type,
          await tailForOrigin(fileLog(), ws.data.origin, command.payload.lines ?? 100, opts.log),
        );
      case "releases.list":
        return ok(command.type, await releases().list(command.payload.limit ?? 5));
      case "resources.get": {
        const snapshot = await resources().snapshot();
        // Issue #1343: the memory hold's threshold travels with the reading the panel shows.
        const pause = opts.memoryPause;
        return ok(command.type, pause ? { ...snapshot, memoryPauseAt: pause.pauseAt() } : snapshot);
      }
      case "resources.endOrphan":
        // Like the other commands that change the host: not from beyond loopback and Tailscale.
        requireVaultTransport(ws.data.origin, "resources.endOrphan", opts.log);
        await resources().endOrphan(command.payload.pid, command.payload.startTicks);
        return ok(command.type, { ended: true });
      case "worktree.list":
        return ok(command.type, await worktrees().list(command.payload.projectId));
      case "worktree.remove":
        return ok(command.type, await worktrees().remove(command.payload.items));
      case "names.list":
        return ok(command.type, {
          names: names()
            .list()
            .map(({ id, ...name }) => ({ sessionId: id, ...name })),
        });
      case "idle.subscribe":
        return ok(command.type, idle().subscribe(command.payload));
      case "issues.list": {
        const { projectId, query } = command.payload;
        return ok(command.type, { issues: await issues().list(projectId, query) });
      }
      case "issues.get":
        return ok(command.type, await issues().get(command.payload.projectId, command.payload.id));
      case "issues.createCard":
        return ok(
          command.type,
          await issues().createCard(command.payload.projectId, command.payload.issueRef),
        );
      case "service.install":
        return ok(
          command.type,
          await need(opts, "serviceInstall")(command.payload.confirm === true),
        );
      case "external.list": {
        const { external, meta } = central();
        const sessions = external
          .list()
          .map((s) => ({ ...externalListed(s), meta: meta.get(s.claudeSessionId) }));
        return ok(command.type, { sessions });
      }
      case "external.watch": {
        // Ack, then the live sessions and the open requests, then every change: no gap.
        const { external, permissions } = central();
        ws.data.unwatchExternal?.();
        const offSessions = external.onChange((session) =>
          send(ws, { type: "external.updated", session: externalListed(session) }),
        );
        const offPermissions = permissions.watch((frame) => {
          send(ws, frame);
          // The session's line names the tool it waits for, known only once the request opens.
          const session = external.get(frame.claudeSessionId);
          if (session) send(ws, { type: "external.updated", session: externalListed(session) });
        });
        ws.data.unwatchExternal = () => {
          offSessions();
          offPermissions();
        };
        ok(command.type);
        for (const session of external.list()) {
          send(ws, { type: "external.updated", session: externalListed(session) });
        }
        for (const frame of permissions.open()) send(ws, frame);
        return;
      }
      case "host.info":
        return ok(command.type, {
          hostName: opts.hostName,
          os: process.platform,
          arch: process.arch,
          daemonVersion: DAEMON_VERSION,
          claudeVersion: (await opts.claude?.version()) ?? null,
          claudePath: opts.claude?.path ?? null,
          uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
          activeSessions: manager.activeSessionCount(),
          apiKeySanitized: manager.apiKeySanitized(),
          // The terminal can be turned on and off while the daemon runs: asked each time.
          features: [
            ...(opts.features ?? features),
            ...(opts.terminals?.enabled ? ["terminal"] : []),
            // Issue #107: `terminal.openSession` opens a shell in a session's folder.
            ...(opts.terminals?.enabled ? ["terminal.session"] : []),
            // Issue #506: a path a terminal printed opens in the Files viewer, from its folder.
            ...(opts.terminals?.enabled && opts.files ? ["file.terminal"] : []),
            ...(opts.ui ? ["ui.mode"] : []),
            ...(opts.templates ? ["templates"] : []),
            ...(opts.tasks ? ["tasks"] : []),
            ...(opts.opencode?.info().available ? ["opencode"] : []),
            ...(opts.assistant ? [ASSISTANT_FEATURE] : []),
            ...(opts.teleport || opts.teleportInbox ? ["teleport"] : []),
            ...(opts.autoUpdate ? ["autoUpdate"] : []),
          ],
          ...(opts.terminals ? { terminal: opts.terminals.settings() } : {}),
          ...(opts.ui ? { ui: { ...opts.ui } } : {}),
          ...(opts.bypass ? { allowBypassPermissions: opts.bypass.allowed() } : {}),
          ...(opts.fileLog ? logPathFor(opts.fileLog, ws.data.origin) : {}),
          ...(opts.sleep ? { sleepAfterMinutes: opts.sleep.minutes() } : {}),
          ...(opts.keepAwake ? { keepAwake: opts.keepAwake.status() } : {}),
          ...(opts.opencode ? { runtimes: [hostRuntime(opts.opencode.info())] } : {}),
          ...updateStatus(),
          ...(opts.autoUpdate ? { autoUpdate: opts.autoUpdate.status() } : {}),
          ...opts.terminal,
        });
      case "roots.add": {
        requireVaultTransport(ws.data.origin, "roots.add", opts.log);
        const { path, confirm } = command.payload;
        return ok(command.type, {
          allowedRoots: await addAllowedRoot(
            opts.allowedRoots as string[],
            path,
            confirm === true,
            opts.persistRoots,
            opts.rootsPlatform,
          ),
        });
      }
      case "gate.respond": {
        const { runId, stepId, attempt, decision, note } = command.payload;
        board().workflows.respond(runId, stepId, attempt, decision, note);
        return ok(command.type, board().workflows.getRun(runId));
      }
      case "roi.summary":
        return ok(command.type, await roi().summaryWithSignals(roiPeriod(command.payload)));
      case "runtime.models": {
        if (!opts.opencode?.info().available) {
          throw new FlightdeckError(
            "invalid_state",
            "OpenCode is not available on this host",
            "runtime_unavailable",
          );
        }
        return ok(command.type, { models: await opts.opencode.models() });
      }
      case "deps.check":
        if (!opts.deps) throw featureOff("depsCheck");
        return ok(command.type, await opts.deps());
      case "doctor.run":
        if (!opts.doctor) throw featureOff("doctor.run");
        return ok(command.type, await opts.doctor(command.payload.appVersion));
      case "statusline.get": {
        const { claudeSessionId } = command.payload;
        return ok(
          command.type,
          statuslineData({
            ...(opts.quota ? { quota: opts.quota } : {}),
            ...(opts.costs ? { costs: opts.costs } : {}),
            today: localDay(Date.now()),
            ...(claudeSessionId ? { claudeSessionId } : {}),
          }),
        );
      }
      case "ui.set": {
        if (!opts.ui) throw featureOff("ui.mode");
        const { mode, locked, confirm } = command.payload;
        if (confirm !== true) {
          throw new FlightdeckError(
            "invalid_state",
            "changing how this host presents itself needs confirm: true",
            "ui_confirm",
          );
        }
        const next: UiSettings = {
          mode: mode ?? opts.ui.mode,
          locked: locked ?? opts.ui.locked,
        };
        await opts.onUiSettings?.(next);
        opts.ui.mode = next.mode;
        opts.ui.locked = next.locked;
        return ok(command.type, { ...next });
      }
      case "pr.comments":
        return ok(command.type, { comments: await board().prComments(command.payload.cardId) });
      case "pr.comments.send": {
        const { cardId, ids } = command.payload;
        return ok(command.type, await board().sendPrComments(cardId, ids));
      }
      case "assistant.run":
        return ok(command.type, await assistant().run(command.payload));
      case "assistant.cancel":
        assistant().cancel(command.payload.requestId);
        return ok(command.type);
      case "assistant.context":
        return ok(command.type, await assistant().context(command.payload));
      case "assistant.record":
        assistant().record(command.payload);
        return ok(command.type);
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
      close(ws) {
        authed.delete(ws);
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
      for (const ws of authed) ws.close(CLOSE_UNAUTHORIZED, "token rotacionado");
    },
    stop: () => {
      stopHeartbeat();
      opts.plugins?.close();
      return server.stop(true);
    },
  };
}
