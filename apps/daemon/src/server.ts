import {
  type Ack,
  type AskpassRequest,
  type BudgetUpdated,
  type CardUpdated,
  type ChangesUpdated,
  CLOSE_HEARTBEAT,
  CLOSE_UNAUTHORIZED,
  Command,
  CommandHeader,
  type CommandResults,
  type CommandType,
  type EventEnvelope,
  type ExternalPermissionFrame,
  type ExternalSession,
  type ExternalStatus,
  type ExternalUpdated,
  type HistoryChanged,
  type IdleFiredFrame,
  type MessagesRelayFrame,
  type MessagesUpdatedFrame,
  type MessagingAlertFrame,
  MIN_PROTOCOL_VERSION,
  type Ping,
  Pong,
  PROTOCOL_VERSION,
  type QuotaUpdated,
  type RunEnvUpdated,
  type RunUpdated,
  type SessionLine,
  type SessionStatus,
  type SessionSummary,
  type TeamsUpdatedFrame,
  type TerminalData,
  type TerminalExited,
  type TerminalResync,
  type VaultAlertFrame,
  type VaultRequestFrame,
  type VaultUsed,
  type WatchUpdatedFrame,
  WS_PATH,
} from "@flightdeck/protocol";
import type { ServerWebSocket } from "bun";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import type { Actions } from "./actions/actions.ts";
import type { AgentConfig } from "./agentcfg/files.ts";
import type { McpConfig } from "./agentcfg/mcp.ts";
import type { Automations } from "./automations/automations.ts";
import type { BgService } from "./bg/service.ts";
import type { Board } from "./board/board.ts";
import { type Central, messageExternal } from "./central/central.ts";
import type { Forker } from "./checkpoints/fork.ts";
import type { Rewinder } from "./checkpoints/rewind.ts";
import type { Snapshots } from "./checkpoints/snapshots.ts";
import { withTurnUuids } from "./checkpoints/turn-uuid.ts";
import type { Budgets } from "./costs/budgets.ts";
import type { Costs } from "./costs/costs.ts";
import { statuslineData } from "./costs/statusline.ts";
import { coalesceDeltas, type DeltaCoalescer, drainAll } from "./delta-coalescer.ts";
import { FlightdeckError, featureOff } from "./errors.ts";
import { listDirs } from "./fs-dirs.ts";
import type { HistoryIndexer } from "./history/indexer.ts";
import { type LiveState, sessionLine } from "./history/session-line.ts";
import type { Issues } from "./issues/issues.ts";
import type { Maintenance } from "./maintenance/maintenance.ts";
import type { ProjectMemory } from "./memory/memory.ts";
import type { Idle } from "./messaging/idle.ts";
import type { Messaging } from "./messaging/messages.ts";
import type { Names } from "./names/names.ts";
import { DEFAULT_ALLOWED_NETWORKS, ipInNetworks } from "./networks.ts";
import { resolveAllowedCwd } from "./paths.ts";
import type { AutoApprover } from "./permissions/auto-approve.ts";
import type { OpenSessionPersonas } from "./personas/open-session.ts";
import type { Personas } from "./personas/store.ts";
import type { Plugins } from "./plugins/plugins.ts";
import type { QuotaHistory } from "./quota/history.ts";
import type { Quota } from "./quota/quota.ts";
import type { UsageLedger } from "./quota/usage.ts";
import { localDay } from "./quota/usage.ts";
import type { Changes } from "./review/changes.ts";
import type { ReviewComments } from "./review/comments.ts";
import type { ReviewFiles } from "./review/files.ts";
import type { SessionFiles } from "./review/session-files.ts";
import type { RunConfigs } from "./runenv/config.ts";
import type { RunManager } from "./runenv/manager.ts";
import type { SessionManager } from "./sessions/session-manager.ts";
import type { HistoryImporter } from "./snippets/history.ts";
import type { Snippets } from "./snippets/store.ts";
import type { SnippetUse } from "./snippets/use.ts";
import type { AskpassBroker } from "./ssh/askpass.ts";
import type { SshConnector } from "./ssh/connect.ts";
import type { HostKeys } from "./ssh/hostkey.ts";
import type { SshImporter } from "./ssh/import.ts";
import type { SshTargets } from "./ssh/targets.ts";
import type { Teams } from "./teams/teams.ts";
import type { TelemetryOptIn } from "./telemetry/optin.ts";
import type { TelemetryStore } from "./telemetry/store.ts";
import type { TerminalManager, TerminalSink } from "./terminal/terminal-manager.ts";
import { tokenMatches } from "./token.ts";
import type { TraceService } from "./trace/service.ts";
import type { DaemonUpdater } from "./updates/apply.ts";
import type { UpdateChecker } from "./updates/check.ts";
import { requireVaultTransport, type Vault } from "./vault/vault.ts";
import type { PrWatch } from "./watch/service.ts";
import { sendFrame } from "./ws-send.ts";

export const DAEMON_VERSION: string = pkg.version;

/** How often the daemon pings each authenticated client; two unanswered pings close it. */
export const PING_INTERVAL_MS = 15_000;
const MAX_MISSED_PINGS = 2;

export interface ServerOptions {
  manager: SessionManager;
  /** Looks up the project of a folder before a session is created in it (without blocking). */
  warmProjectKey?: (cwd: string) => Promise<unknown>;
  hostName: string;
  bind: string;
  port: number;
  token: string;
  allowedRoots: readonly string[];
  /** Announce `fs.dirs` in `host.info`: the app offers its folder picker only to such a host. */
  fsDirs?: boolean;
  /** CIDR ranges allowed to connect; defaults to loopback only. */
  allowedNetworks?: readonly string[];
  pingIntervalMs?: number;
  /** Transcript index behind the `history.*` commands. */
  history?: HistoryIndexer;
  /** Projects and cards behind the `project.*`, `board.*` and `card.*` commands. */
  board?: Board;
  /** The run environment of the cards: the run.yaml and the processes (phase 24). */
  runenv?: { configs: RunConfigs; manager: RunManager };
  /** External sessions and their permission requests (phase 5). */
  central?: Central;
  /** Retention and backups behind the `maintenance.*` commands (phase 7). */
  maintenance?: Maintenance;
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
  /** Called after acking `daemon.shutdown`; without it the command is refused. */
  onShutdown?: () => void;
  /** What `host.info` announces; derived from what this daemon has when absent. */
  features?: string[];
  /** The host's plan quota behind `quota.*` (phase 7). */
  quota?: Quota;
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
  /** Phase 27: Claude Code's background sessions, through its own CLI. */
  bg?: BgService;
  /** Budgets behind the `budget.*` commands (phase 8). */
  budgets?: Budgets;
  /** The quota's samples behind `quota.history` (phase 8). */
  quotaHistory?: QuotaHistory;
  /** The diff of sessions and cards behind `changes.*` (phase 11). */
  changes?: Changes;
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
  /** Called after `terminal.settings` changes whether terminals are on (the config keeps it). */
  onTerminalSettings?: (enabled: boolean) => void;
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

interface Connection {
  authed: boolean;
  /** Where the connection came from (the address the origin filter looked at). */
  origin: string;
  subscriptions: Map<string, () => void>;
  /** One per subscription: the text that waits for its window or for the socket to drain. */
  coalescers: Set<DeltaCoalescer>;
  /** A frame was dropped: the client was cut off and gets nothing more (`sendFrame`). */
  dropped?: boolean;
  /** Pings sent and not yet answered, by id → send time. */
  pendingPings: Map<string, number>;
  /** Stops the `sessions.watch` stream, when active. */
  unwatch?: () => void;
  /** Stops the `history.watch` stream, when active. */
  unwatchHistory?: () => void;
  /** Stops the `board.watch` stream, when active. */
  unwatchBoard?: () => void;
  /** Stops the `external.watch` stream, when active. */
  unwatchExternal?: () => void;
  /** Stops the `run.watch` stream, when active. */
  unwatchRuns?: () => void;
  unwatchRunEnv?: () => void;
  /** Stops the `quota.watch` stream, when active. */
  unwatchQuota?: () => void;
  /** Stops the `askpass.watch` stream, when active. */
  unwatchAskpass?: () => void;
  /** Stops the `budget.watch` stream, when active. */
  unwatchBudgets?: () => void;
  /** Stops each `changes.watch`, by target. */
  changeWatchers: Map<string, () => void>;
  /** This connection's end of the terminals it is attached to. */
  terminalSink?: TerminalSink;
  /** Stops the `vault.watch` stream, when active. */
  unwatchVault?: () => void;
  /** Stops the `messages.watch` stream, when active. */
  unwatchMessages?: () => void;
  /** Stops the `teams.watch` stream, when active. */
  unwatchTeams?: () => void;
  /** Stops the `watch.watch` stream, when active. */
  unwatchPrs?: () => void;
  lastRttMs?: number;
}

export { tokenMatches };

type Socket = ServerWebSocket<Connection>;

type Outgoing =
  | Ack
  | EventEnvelope
  | Ping
  | HistoryChanged
  | CardUpdated
  | ExternalUpdated
  | ExternalPermissionFrame
  | RunUpdated
  | RunEnvUpdated
  | QuotaUpdated
  | BudgetUpdated
  | ChangesUpdated
  | TerminalData
  | TerminalExited
  | TerminalResync
  | AskpassRequest
  | VaultUsed
  | VaultRequestFrame
  | VaultAlertFrame
  | MessagesUpdatedFrame
  | MessagesRelayFrame
  | MessagingAlertFrame
  | IdleFiredFrame
  | TeamsUpdatedFrame
  | WatchUpdatedFrame;

function send(ws: Socket, message: Outgoing): void {
  sendFrame(ws, message);
}

function ackError(
  ws: Socket,
  id: string,
  code: string,
  message: string,
  why: Pick<FlightdeckError, "reason" | "params"> = {},
): void {
  const { reason, params } = why;
  send(ws, {
    type: "ack",
    id,
    ok: false,
    error: { code, message, ...(reason ? { reason, params: params ?? {} } : {}) },
  });
}

function decode(raw: string | Buffer): unknown {
  return JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
}

/** Phase 8: the state of a session's line, from its live status. */
const MANAGED_LINE: Record<SessionStatus, SessionLine["state"]> = {
  starting: "running",
  running: "running",
  awaiting_permission: "waiting",
  idle: "idle",
  ended: "ended",
  error: "ended",
};

const EXTERNAL_LINE: Record<ExternalStatus, SessionLine["state"]> = {
  running: "running",
  awaiting_permission: "waiting",
  idle: "idle",
  unknown: "idle",
  ended: "ended",
};

export function startServer(opts: ServerOptions): RunningServer {
  const { manager } = opts;

  const unauthorized = (ws: Socket) => ws.close(CLOSE_UNAUTHORIZED, "unauthorized");
  const authed = new Set<Socket>();
  let currentToken = opts.token;
  const startedAt = Date.now();
  /** What this daemon has, as `host.info` announces it; the app hides what is missing. */
  const features = [
    // The folder picker of the app browses the host's folders with `fs.dirs`.
    ...(opts.fsDirs ? ["fs.dirs"] : []),
    ...(opts.central ? ["central"] : []),
    ...(opts.board ? ["workflows"] : []),
    // Phase 24: the run.yaml of a card and its processes.
    ...(opts.runenv && opts.board ? ["runenv"] : []),
    ...(opts.maintenance ? ["maintenance"] : []),
    ...(opts.quota ? ["quota"] : []),
    // Project rules live in the board's projects.
    ...(opts.board ? ["rules"] : []),
    ...(opts.costs ? ["costs"] : []),
    ...(opts.telemetry ? ["telemetry"] : []),
    ...(opts.trace ? ["trace"] : []),
    ...(opts.bg ? ["bg"] : []),
    ...(opts.changes ? ["review"] : []),
    // Phase 12: the timeline's snapshots, rewind and fork; the agent's MCP, CLAUDE.md, agents and skills.
    ...(opts.snapshots && opts.rewinder && opts.forker ? ["checkpoints"] : []),
    ...(opts.agentcfg && opts.mcp ? ["agentcfg"] : []),
    ...(opts.memory ? ["memory"] : []),
    ...(opts.plugins ? ["plugins"] : []),
    // Phase 13: the arena is the board's; issues and automations are services of their own.
    ...(opts.board ? ["arena"] : []),
    ...(opts.issues ? ["issues"] : []),
    ...(opts.automations ? ["automation"] : []),
    ...(opts.autoApprove ? ["autoapprove"] : []),
    // Phase 15: the app shows Conexões for hosts that keep ssh destinos.
    ...(opts.ssh ? ["ssh"] : []),
    // Phase 17: the actions that use a vault secret without Claude seeing it.
    ...(opts.actions ? ["actions"] : []),
    // Phase 18: saved commands and prompts of the host and its projects.
    ...(opts.snippets ? ["snippets"] : []),
    // Phase 20: the engineering personas of the host and its projects.
    ...(opts.personas ? ["personas"] : []),
    // Phase 21: messages between sessions, teams and the standard session names.
    ...(opts.messaging ? ["messaging"] : []),
    ...(opts.teams ? ["teams"] : []),
    // Phase 22: watching a card's PR and fixing it.
    ...(opts.watch ? ["watch"] : []),
    ...(opts.names ? ["names"] : []),
  ];
  let pingSeq = 0;

  const heartbeat = setInterval(() => {
    for (const ws of authed) {
      if (ws.data.pendingPings.size >= MAX_MISSED_PINGS) {
        ws.close(CLOSE_HEARTBEAT, "heartbeat timeout");
        continue;
      }
      const id = String(++pingSeq);
      ws.data.pendingPings.set(id, performance.now());
      const { lastRttMs } = ws.data;
      send(ws, { type: "ping", id, ...(lastRttMs !== undefined ? { lastRttMs } : {}) });
    }
  }, opts.pingIntervalMs ?? PING_INTERVAL_MS);

  /** The daemon measures the round trip: the app cannot time a ping it did not send. */
  function onPong(ws: Socket, frame: unknown): void {
    const pong = Pong.safeParse(frame);
    const sentAt = pong.success ? ws.data.pendingPings.get(pong.data.id) : undefined;
    if (sentAt === undefined) return;
    ws.data.lastRttMs = Math.round(performance.now() - sentAt);
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
    };
    send(ws, { type: "ack", id: parsed.data.id, ok: true, data });
  }

  function history(): HistoryIndexer {
    if (!opts.history) throw featureOff("history");
    return opts.history;
  }

  function central() {
    if (!opts.central) throw featureOff("central");
    return opts.central;
  }

  /**
   * Phase 5: every session list carries its project group and meta (with the hub on). Phase 8:
   * and its line, with the transcript index on.
   */
  function listed<T extends { cwd: string }>(
    session: T,
    claudeSessionId: string | null,
    live: LiveState,
  ): T {
    const hub = opts.central;
    const summary = line(claudeSessionId, live);
    return {
      ...session,
      ...(hub
        ? { projectKey: hub.projectKey(session.cwd), meta: hub.meta.get(claudeSessionId ?? "") }
        : {}),
      ...(summary ? { summary } : {}),
    };
  }

  function vault(): Vault {
    if (!opts.vault) throw featureOff("vault");
    return opts.vault;
  }

  function names(): Names {
    if (!opts.names) throw featureOff("names");
    return opts.names;
  }

  function watching(): PrWatch {
    if (!opts.watch) throw new FlightdeckError("invalid_state", "vigia de PR indisponível");
    return opts.watch;
  }

  function teams(): Teams {
    if (!opts.teams) throw featureOff("teams");
    return opts.teams;
  }

  function messaging(): Messaging {
    if (!opts.messaging) throw featureOff("messaging");
    return opts.messaging;
  }

  function idle(): Idle {
    if (!opts.idle) throw featureOff("idle");
    return opts.idle;
  }

  function actions(): Actions {
    if (!opts.actions) throw featureOff("actions");
    return opts.actions;
  }

  function automations(): Automations {
    if (!opts.automations) throw featureOff("automations");
    return opts.automations;
  }

  function issues(): Issues {
    if (!opts.issues) throw featureOff("issues");
    return opts.issues;
  }

  function autoApprove(): AutoApprover {
    if (!opts.autoApprove) throw featureOff("autoApprove");
    return opts.autoApprove;
  }

  function agentcfg(): AgentConfig {
    if (!opts.agentcfg) throw featureOff("agentcfg");
    return opts.agentcfg;
  }

  function mcp(): McpConfig {
    if (!opts.mcp) throw featureOff("mcp");
    return opts.mcp;
  }

  const projectPath = (projectId: string) => board().getProject(projectId).path;

  function pluginsApi(): Plugins {
    if (!opts.plugins) throw featureOff("plugins");
    return opts.plugins;
  }

  function memory(): ProjectMemory {
    if (!opts.memory) throw featureOff("memory");
    return opts.memory;
  }

  function rewinder(): Rewinder {
    if (!opts.rewinder) throw featureOff("rewinder");
    return opts.rewinder;
  }

  /** `host.info.update` once the daemon has checked its manifest. */
  function updateStatus() {
    const update = opts.updates?.status();
    return update ? { update } : {};
  }

  function line(claudeSessionId: string | null, live: LiveState): SessionLine | null {
    if (!opts.history) return null;
    return sessionLine(claudeSessionId ? opts.history.lastActivity(claudeSessionId) : null, live);
  }

  const managedLive = (s: SessionSummary): LiveState => ({
    state: MANAGED_LINE[s.status],
    waitingTool: manager.pendingPermissions(s.id)[0]?.toolName ?? null,
    since: s.updatedAt,
  });

  /** An external session as the lists and `external.updated` send it: with its line and name. */
  function externalListed(s: ExternalSession): ExternalSession {
    const waiting = opts.central?.permissions
      .open()
      .find((frame) => frame.claudeSessionId === s.claudeSessionId);
    const summary = line(s.claudeSessionId, {
      state: EXTERNAL_LINE[s.status],
      waitingTool: waiting?.toolName ?? null,
      since: s.lastEventAt,
    });
    const meta = opts.central?.meta.get(s.claudeSessionId);
    return { ...s, ...(summary ? { summary } : {}), ...(meta ? { meta } : {}) };
  }

  function maintenance(): Maintenance {
    if (!opts.maintenance) throw featureOff("maintenance");
    return opts.maintenance;
  }

  function usage(): UsageLedger {
    if (!opts.usage) throw featureOff("usage");
    return opts.usage;
  }

  function quota(): Quota {
    if (!opts.quota) throw featureOff("quota");
    return opts.quota;
  }

  function costs(): Costs {
    if (!opts.costs) throw featureOff("costs");
    return opts.costs;
  }

  function telemetry(): TelemetryStore {
    if (!opts.telemetry) throw featureOff("telemetry");
    return opts.telemetry;
  }

  function bg(): BgService {
    if (!opts.bg) throw featureOff("bg");
    return opts.bg;
  }

  function trace(): TraceService {
    if (!opts.trace) throw featureOff("trace");
    return opts.trace;
  }

  function optIn(): TelemetryOptIn {
    if (!opts.telemetryOptIn) throw featureOff("telemetry");
    return opts.telemetryOptIn;
  }

  function budgets(): Budgets {
    if (!opts.budgets) throw featureOff("budgets");
    return opts.budgets;
  }

  function quotaHistory(): QuotaHistory {
    if (!opts.quotaHistory) throw featureOff("quotaHistory");
    return opts.quotaHistory;
  }

  function changes(): Changes {
    if (!opts.changes) throw featureOff("changes");
    return opts.changes;
  }

  function ssh(): SshTargets {
    if (!opts.ssh) throw featureOff("ssh");
    return opts.ssh;
  }

  function snippets(): Snippets {
    if (!opts.snippets) throw featureOff("snippets");
    return opts.snippets;
  }

  function personaSessions(): OpenSessionPersonas {
    if (!opts.personaSessions) throw featureOff("personaSessions");
    return opts.personaSessions;
  }

  function personas(): Personas {
    if (!opts.personas) throw featureOff("personas");
    return opts.personas;
  }

  function snippetUse(): SnippetUse {
    if (!opts.snippetUse) throw featureOff("snippetUse");
    return opts.snippetUse;
  }

  function snippetHistory(): HistoryImporter {
    if (!opts.snippetHistory) throw featureOff("snippetHistory");
    return opts.snippetHistory;
  }

  function askpass(): AskpassBroker {
    if (!opts.askpass) throw featureOff("askpass");
    return opts.askpass;
  }

  function sshConnect(): SshConnector {
    if (!opts.sshConnect) throw featureOff("sshConnect");
    return opts.sshConnect;
  }

  function sshHostKeys(): HostKeys {
    if (!opts.sshHostKeys) throw featureOff("sshHostKeys");
    return opts.sshHostKeys;
  }

  function sshImport(): SshImporter {
    if (!opts.sshImport) throw featureOff("sshImport");
    return opts.sshImport;
  }

  function review(): ReviewComments {
    if (!opts.review) throw featureOff("review");
    return opts.review;
  }

  function files(): ReviewFiles {
    if (!opts.files) throw featureOff("files");
    return opts.files;
  }

  /** A project's folder, with the root of its repository looked up first without waiting for git. */
  async function memoryProject(projectId: string): Promise<string> {
    const path = projectPath(projectId);
    await memory().warm(path);
    return path;
  }

  function sessionFiles(): SessionFiles {
    if (!opts.sessionFiles) throw featureOff("sessionFiles");
    return opts.sessionFiles;
  }

  function terminals(): TerminalManager {
    if (!opts.terminals) throw featureOff("terminals");
    return opts.terminals;
  }

  /** The connection's end of its terminals: frames out, and how full its socket is. */
  function terminalSink(ws: Socket): TerminalSink {
    ws.data.terminalSink ??= {
      send: (frame) => send(ws, frame),
      backlog: () => ws.getBufferedAmount(),
    };
    return ws.data.terminalSink;
  }

  function runenv() {
    if (!opts.runenv) throw new FlightdeckError("invalid_state", "ambiente de execução desativado");
    return opts.runenv;
  }

  function board(): Board {
    if (!opts.board) throw featureOff("board");
    return opts.board;
  }

  function subscribe(ws: Socket, sessionId: string, sinceSeq: number) {
    ws.data.subscriptions.get(sessionId)?.();
    // The text of a stream goes out a few frames at a time; every other event flushes it first.
    const coalescer = coalesceDeltas({
      deliver: (envelope) => send(ws, envelope),
      backlog: () => ws.getBufferedAmount(),
    });
    ws.data.coalescers.add(coalescer);
    const sub = manager.subscribe(sessionId, sinceSeq, (envelope) => coalescer.push(envelope));
    ws.data.subscriptions.set(sessionId, () => {
      sub.unsubscribe();
      coalescer.stop();
      ws.data.coalescers.delete(coalescer);
    });
    return sub;
  }

  async function dispatch(ws: Socket, command: Command): Promise<void> {
    const ok = <T extends CommandType>(_type: T, data?: CommandResults[T]) =>
      send(ws, { type: "ack", id: command.id, ok: true, ...(data !== undefined ? { data } : {}) });

    switch (command.type) {
      case "hello":
        return onHello(ws, command);
      case "session.list":
        return ok(command.type, {
          sessions: manager.list().map((s) => listed(s, s.claudeSessionId, managedLive(s))),
        });
      case "session.create": {
        // Looked up in git before the session exists, so what names and lists it finds the
        // project already known; the wait is this request's own, the others are served meanwhile.
        if (opts.warmProjectKey) {
          const cwd = resolveAllowedCwd(command.payload.cwd, opts.allowedRoots);
          await opts.warmProjectKey(cwd);
        }
        return ok(command.type, manager.create(command.payload));
      }
      case "session.send":
        return ok(command.type, manager.send(command.payload.sessionId, command.payload.text));
      case "session.interrupt":
        await manager.interrupt(command.payload.sessionId);
        return ok(command.type);
      case "session.close":
        await manager.close(command.payload.sessionId);
        return ok(command.type);
      case "session.resume":
        await manager.resume(command.payload.sessionId);
        return ok(command.type);
      case "session.subscribe": {
        // Ack, replay and live registration happen in one synchronous step: no gap, no dupes.
        const sub = subscribe(ws, command.payload.sessionId, command.payload.sinceSeq ?? 0);
        ok(command.type, { session: sub.session, replayed: sub.replay.length });
        for (const envelope of sub.replay) send(ws, envelope);
        return;
      }
      case "session.unsubscribe":
        ws.data.subscriptions.get(command.payload.sessionId)?.();
        ws.data.subscriptions.delete(command.payload.sessionId);
        return ok(command.type);
      case "permission.respond": {
        // External requests (ids `ext-…`) are held hooks; anything else is a managed session's.
        const { requestId, decision, message, updatedPermissions } = command.payload;
        const external = opts.central?.permissions;
        if (!external?.respond(requestId, decision, message, updatedPermissions)) {
          manager.respondPermission(command.payload);
        }
        return ok(command.type);
      }
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
      case "session.meta.set": {
        const { claudeSessionId, ...patch } = command.payload;
        const meta = central().meta.set(claudeSessionId, patch);
        // The name the user gives also renames the standard one; the old alias keeps working.
        const given = patch.name?.trim();
        if (given && opts.names) {
          const id =
            opts.manager.list().find((s) => s.claudeSessionId === claudeSessionId)?.id ??
            claudeSessionId;
          if (opts.names.get(id)) opts.names.rename(id, given);
        }
        return ok(command.type, { claudeSessionId, ...meta });
      }
      case "maintenance.status":
        return ok(command.type, maintenance().status());
      case "maintenance.backup":
        return ok(command.type, maintenance().backupNow());
      case "maintenance.prune":
        return ok(command.type, maintenance().prune(command.payload.dryRun === true));
      case "snapshots.list":
        return ok(command.type, {
          // A terminal turn's uuid is found in the indexed transcript, when it can be told.
          snapshots: withTurnUuids(
            opts.snapshots?.list(command.payload.claudeSessionId) ?? [],
            opts.history?.userPrompts(command.payload.claudeSessionId) ?? [],
          ),
        });
      case "snapshots.files": {
        if (!opts.snapshots) throw featureOff("snapshots");
        const { claudeSessionId, n } = command.payload;
        return ok(command.type, await opts.snapshots.files(claudeSessionId, n));
      }
      case "mcp.list":
        return ok(command.type, { servers: mcp().list(projectPath(command.payload.projectId)) });
      case "mcp.test": {
        const { projectId, name, confirm } = command.payload;
        return ok(command.type, await mcp().test(projectPath(projectId), name, confirm === true));
      }
      case "mcp.save": {
        const path = projectPath(command.payload.projectId);
        mcp().save(path, command.payload.server, command.payload.confirm === true);
        return ok(command.type, { servers: mcp().list(path) });
      }
      case "mcp.remove": {
        const path = projectPath(command.payload.projectId);
        mcp().remove(path, command.payload.name, command.payload.confirm === true);
        return ok(command.type, { servers: mcp().list(path) });
      }
      case "mcp.toggle": {
        const { projectId, name, enabled, confirm, sessionId } = command.payload;
        const path = projectPath(projectId);
        mcp().toggle(path, name, enabled, confirm === true);
        if (sessionId) await manager.toggleMcpServer(sessionId, name, enabled);
        return ok(command.type, { servers: mcp().list(path) });
      }
      case "mcp.status":
        return ok(command.type, { servers: await manager.mcpStatus(command.payload.sessionId) });
      case "card.startArena": {
        const { cardId, ...input } = command.payload;
        return ok(command.type, await board().startArena(cardId, input));
      }
      case "card.arena":
        return ok(command.type, await board().arena(command.payload.cardId));
      case "card.chooseVariant": {
        const { cardId, variantId, confirm } = command.payload;
        return ok(command.type, await board().chooseVariant(cardId, variantId, confirm === true));
      }
      case "vault.deliver":
        // A request of the daemon that asks has to be approved before its secret is accepted.
        opts.actions?.gate(command.payload.purpose);
        return ok(command.type, vault().deliver(command.payload, ws.data.origin));
      case "vault.use": {
        const { secretId, purpose, action } = command.payload;
        const used = vault().use(secretId, purpose, action);
        // For the app's usage log: who, for what, when; never the value.
        send(ws, {
          type: "vault.used",
          secretId,
          purpose,
          requester: used.requester,
          action,
          at: new Date().toISOString(),
        });
        return ok(command.type, { result: used.result });
      }
      case "actions.list":
        return ok(command.type, await actions().list(command.payload.projectId));
      case "actions.save":
        return ok(command.type, await actions().save(command.payload));
      case "actions.remove":
        return ok(
          command.type,
          await actions().remove(command.payload.projectId, command.payload.name),
        );
      case "actions.trust": {
        const { projectId, name, hash } = command.payload;
        return ok(command.type, await actions().trust(projectId, name, hash));
      }
      case "actions.run":
        return ok(command.type, await actions().run(command.payload));
      case "actions.runFree":
        return ok(command.type, await actions().runFree(command.payload));
      case "actions.runs":
        return ok(command.type, { runs: actions().runs(command.payload) });
      case "vault.watch": {
        const service = actions();
        ws.data.unwatchVault?.();
        ws.data.unwatchVault = service.watch((frame) => send(ws, frame));
        return ok(command.type);
      }
      case "vault.deny":
        actions().deny(command.payload.requestId);
        return ok(command.type);
      case "teams.list":
        return ok(command.type, { teams: teams().list(command.payload.projectId) });
      case "teams.create":
        return ok(command.type, await teams().create(command.payload));
      case "teams.update":
        return ok(command.type, await teams().update(command.payload));
      case "teams.pause":
        return ok(command.type, teams().pause(command.payload.team));
      case "teams.resume":
        return ok(command.type, teams().resume(command.payload.team));
      case "teams.close":
        return ok(
          command.type,
          teams().close(command.payload.team, command.payload.confirm === true),
        );
      case "teams.message":
        return ok(command.type, teams().message(command.payload.team, command.payload.text));
      case "teams.status": {
        const { team, as } = command.payload;
        const asker = as ? messaging().whoIs(as).id : undefined;
        return ok(command.type, teams().status(team, asker));
      }
      case "watch.settings":
        return ok(
          command.type,
          watching().settings(command.payload.projectId, command.payload.patch),
        );
      case "watch.set":
        return ok(command.type, watching().set(command.payload.cardId, command.payload.enabled));
      case "watch.get":
        return ok(command.type, watching().info(command.payload.cardId));
      case "watch.trace":
        return ok(command.type, watching().trace(command.payload.cardId));
      case "watch.describe":
        return ok(command.type, watching().describe(command.payload.cardId));
      case "watch.byUrl":
        return ok(command.type, watching().byUrl(command.payload.url));
      case "watch.watch": {
        const service = watching();
        ws.data.unwatchPrs?.();
        ws.data.unwatchPrs = service.watch((frame) => send(ws, frame));
        return ok(command.type);
      }
      case "teams.watch": {
        const service = teams();
        ws.data.unwatchTeams?.();
        ws.data.unwatchTeams = service.watch((frame) => send(ws, frame));
        return ok(command.type);
      }
      case "messages.send":
        return ok(command.type, messaging().send(command.payload));
      case "messages.list":
        return ok(command.type, { messages: messaging().list(command.payload) });
      case "messages.sessions":
        return ok(command.type, { sessions: messaging().sessions(command.payload.as) });
      case "messages.read": {
        const { as, session, last } = command.payload;
        return ok(command.type, messaging().read(as, session, last));
      }
      case "messages.relay":
        return ok(command.type, messaging().relay(command.payload.message));
      case "messages.relayed": {
        const { id, ...result } = command.payload;
        messaging().relayed(id, result);
        return ok(command.type);
      }
      case "messages.directory":
        return ok(command.type, { host: opts.hostName, sessions: messaging().directory() });
      case "names.list":
        return ok(command.type, {
          names: names()
            .list()
            .map(({ id, ...name }) => ({ sessionId: id, ...name })),
        });
      case "messages.peers":
        messaging().setPeers(command.payload.host, command.payload.sessions);
        return ok(command.type);
      case "messages.watch": {
        const service = messaging();
        const watched = idle();
        ws.data.unwatchMessages?.();
        const stopMessages = service.watch((frame) => send(ws, frame));
        const stopIdle = watched.watch((frame) => send(ws, frame));
        ws.data.unwatchMessages = () => {
          stopMessages();
          stopIdle();
        };
        return ok(command.type);
      }
      case "idle.subscribe":
        return ok(command.type, idle().subscribe(command.payload));
      case "messaging.rules.get":
        return ok(command.type, {
          policy: messaging().getPolicy() as unknown as Record<string, unknown>,
          paused: messaging().pausedPairs(),
        });
      case "messaging.rules.set": {
        const { policy, unpause } = command.payload;
        const set = messaging().setPolicy(policy, unpause);
        return ok(command.type, {
          policy: set.policy as unknown as Record<string, unknown>,
          paused: set.paused,
        });
      }
      case "vault.rules.set": {
        const { secretId, tags, rules } = command.payload;
        return ok(command.type, { rules: actions().setRules(secretId, tags ?? [], rules) });
      }
      case "vault.rules.get": {
        const { secretId } = command.payload;
        return ok(command.type, { secretId, ...actions().getRules(secretId) });
      }
      case "vault.rules.preview":
        return ok(command.type, actions().preview(command.payload));
      case "vault.approve": {
        const { requestId, ...approval } = command.payload;
        actions().approve(requestId, approval);
        return ok(command.type);
      }
      case "vault.decisions":
        return ok(command.type, { decisions: actions().decisions(command.payload) });
      case "vault.report":
        return ok(command.type, actions().report(command.payload));
      case "automation.list":
        return ok(command.type, { automations: automations().list(command.payload.projectId) });
      case "automation.save":
        return ok(command.type, automations().save(command.payload));
      case "automation.remove":
        return ok(command.type, {
          automations: automations().remove(command.payload.id, command.payload.confirm === true),
        });
      case "automation.toggle": {
        const { id, enabled, confirm } = command.payload;
        return ok(command.type, automations().toggle(id, enabled, confirm === true));
      }
      case "automation.runs":
        return ok(command.type, {
          runs: automations().runs(command.payload.id, command.payload.limit),
        });
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
      case "autoapprove.list": {
        const { projectId, sessionKey, limit } = command.payload;
        return ok(command.type, {
          decisions: autoApprove().list({
            ...(projectId ? { projectId } : {}),
            ...(sessionKey ? { sessionKey } : {}),
            ...(limit ? { limit } : {}),
          }),
          suspended: autoApprove().suspended(),
        });
      }
      case "autoapprove.resume": {
        if (command.payload.confirm !== true) {
          throw new FlightdeckError(
            "invalid_state",
            "reativar a aprovação automática pede confirm: true",
          );
        }
        autoApprove().resume(command.payload.sessionKey);
        return ok(command.type, { suspended: autoApprove().suspended() });
      }
      case "agentcfg.list": {
        const { projectId, kind } = command.payload;
        return ok(command.type, { items: agentcfg().list(projectPath(projectId), kind) });
      }
      case "agentcfg.read": {
        const { projectId, kind, path, origin } = command.payload;
        return ok(command.type, agentcfg().read(projectPath(projectId), kind, path, origin));
      }
      case "agentcfg.write": {
        const { projectId, confirm, ...input } = command.payload;
        const written = agentcfg().write(projectPath(projectId), {
          ...input,
          confirm: confirm === true,
        });
        return ok(command.type, written);
      }
      case "plugins.list":
        return ok(command.type, await pluginsApi().list());
      case "plugins.detail":
        return ok(command.type, await pluginsApi().detail(command.payload.plugin));
      case "plugins.preview": {
        const { plugin, dir } = command.payload;
        return ok(
          command.type,
          await pluginsApi().preview(dir !== undefined ? { dir } : { plugin: plugin as string }),
        );
      }
      case "plugins.previewUpdate":
        return ok(command.type, await pluginsApi().previewUpdate(command.payload.plugin));
      case "plugins.install":
        return ok(command.type, await pluginsApi().install(command.payload));
      case "plugins.update":
        return ok(command.type, await pluginsApi().update(command.payload));
      case "plugins.uninstall": {
        const { confirm, ...input } = command.payload;
        return ok(
          command.type,
          await pluginsApi().uninstall({ ...input, confirm: confirm === true }),
        );
      }
      case "plugins.pin":
        return ok(
          command.type,
          await pluginsApi().pin(command.payload.plugin, command.payload.pinned),
        );
      case "plugins.marketplaceAdd": {
        const { confirm, ...input } = command.payload;
        return ok(
          command.type,
          await pluginsApi().marketplaceAdd({ ...input, confirm: confirm === true }),
        );
      }
      case "plugins.marketplaceRemove": {
        const { confirm, ...input } = command.payload;
        return ok(
          command.type,
          await pluginsApi().marketplaceRemove({ ...input, confirm: confirm === true }),
        );
      }
      case "plugins.marketplaceUpdate":
        return ok(command.type, await pluginsApi().marketplaceUpdate(command.payload.name));
      case "memory.list":
        return ok(command.type, memory().list(await memoryProject(command.payload.projectId)));
      case "memory.read": {
        const { projectId, name } = command.payload;
        return ok(command.type, memory().read(await memoryProject(projectId), name));
      }
      case "memory.write": {
        const { projectId, confirm, ...input } = command.payload;
        return ok(
          command.type,
          memory().write(await memoryProject(projectId), { ...input, confirm: confirm === true }),
        );
      }
      case "memory.delete": {
        const { projectId, confirm, ...input } = command.payload;
        memory().remove(await memoryProject(projectId), { ...input, confirm: confirm === true });
        return ok(command.type, { name: input.name });
      }
      case "memory.budget":
        return ok(command.type, memory().budget(await memoryProject(command.payload.projectId)));
      case "memory.suggest":
        return ok(command.type, {
          suggestions: memory().suggest(await memoryProject(command.payload.projectId)),
        });
      case "session.fork": {
        if (!opts.forker) throw featureOff("forker");
        return ok(command.type, await opts.forker.fork(command.payload));
      }
      case "rewind.preview": {
        const { claudeSessionId, turn } = command.payload;
        return ok(command.type, await rewinder().preview(claudeSessionId, turn));
      }
      case "rewind.apply": {
        const { claudeSessionId, turn, confirm } = command.payload;
        return ok(command.type, await rewinder().apply(claudeSessionId, turn, confirm === true));
      }
      case "rewind.undo": {
        const { claudeSessionId, confirm } = command.payload;
        return ok(command.type, await rewinder().undo(claudeSessionId, confirm === true));
      }
      case "daemon.update.apply": {
        if (!opts.updater) throw featureOff("updater");
        return ok(command.type, await opts.updater.apply(command.payload.confirm === true));
      }
      case "daemon.shutdown": {
        const shutdown = opts.onShutdown;
        if (!shutdown) throw featureOff("shutdown");
        ok(command.type);
        // Right after the ack is written (a microtask, not a timer tick that may come late).
        queueMicrotask(shutdown);
        return;
      }
      case "hooks.status":
        return ok(command.type, central().hooksStatus());
      case "hooks.install":
        return ok(command.type, central().hooksInstall(command.payload.confirm === true));
      case "hooks.uninstall":
        return ok(command.type, central().hooksUninstall(command.payload.confirm === true));
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
          ],
          ...(opts.terminals ? { terminal: opts.terminals.settings() } : {}),
          ...updateStatus(),
          ...(opts.terminal ?? {}),
        });
      case "history.list": {
        const page = history().list(command.payload);
        const sessions = page.sessions.map((s) =>
          listed(s, s.claudeSessionId, { state: "ended", since: s.lastTs }),
        );
        return ok(command.type, { ...page, sessions });
      }
      case "history.get": {
        const { claudeSessionId, cursor, limit } = command.payload;
        return ok(command.type, history().get(claudeSessionId, cursor, limit));
      }
      case "history.search": {
        const index = history();
        const hits = index.search(command.payload).map((hit) => ({
          ...hit,
          cursor: index.cursorFor(hit.claudeSessionId, hit.uuid),
        }));
        return ok(command.type, { hits });
      }
      case "history.resume": {
        const { claudeSessionId, force, name, permissionMode } = command.payload;
        const session = history().session(claudeSessionId);
        if (!session) {
          throw new FlightdeckError(
            "not_found",
            `transcript ${claudeSessionId} not indexed`,
            "transcript_not_indexed",
            { id: claudeSessionId },
          );
        }
        if (session.maybeActive && !force) {
          throw new FlightdeckError(
            "invalid_state",
            "session possibly in use elsewhere; send force: true to resume anyway",
            "session_maybe_active",
          );
        }
        return ok(
          command.type,
          manager.createResumed({
            cwd: session.cwd,
            claudeSessionId,
            name: name ?? session.title,
            ...(permissionMode ? { permissionMode } : {}),
          }),
        );
      }
      case "history.watch": {
        const index = history();
        ws.data.unwatchHistory?.();
        ws.data.unwatchHistory = index.onChange((change) =>
          send(ws, { type: "history.changed", ...change }),
        );
        return ok(command.type);
      }
      case "project.list":
        return ok(command.type, {
          projects: board().listProjects(),
          maxParallelRuns: board().maxParallelRuns,
        });
      case "project.add":
        return ok(command.type, await board().addProject(command.payload));
      case "project.update": {
        const { projectId, ...patch } = command.payload;
        return ok(command.type, board().updateProject(projectId, patch));
      }
      case "board.get":
        return ok(command.type, board().getBoard(command.payload.projectId));
      case "board.settings": {
        const { maxParallelRuns } = command.payload;
        if (maxParallelRuns !== undefined) board().setMaxParallelRuns(maxParallelRuns);
        return ok(command.type, { maxParallelRuns: board().maxParallelRuns });
      }
      case "board.watch": {
        const cards = board();
        ws.data.unwatchBoard?.();
        ws.data.unwatchBoard = cards.watch((card) => send(ws, { type: "card.updated", card }));
        return ok(command.type);
      }
      case "card.create": {
        const { projectId, title, description } = command.payload;
        return ok(command.type, board().createCard(projectId, { title, description }));
      }
      case "card.update": {
        const { cardId, ...patch } = command.payload;
        return ok(command.type, board().updateCard(cardId, patch));
      }
      case "card.move": {
        const { cardId, column, position } = command.payload;
        return ok(command.type, board().moveCard(cardId, column, position));
      }
      case "card.get":
        return ok(command.type, board().getCard(command.payload.cardId));
      case "workflow.list":
        return ok(command.type, {
          workflows: await board().listWorkflows(command.payload.projectId),
        });
      case "workflow.validate": {
        const { projectId, name } = command.payload;
        return ok(command.type, await board().validateWorkflow(projectId, name));
      }
      case "workflow.trust": {
        const { projectId, name, hash } = command.payload;
        return ok(command.type, await board().trustWorkflow(projectId, name, hash));
      }
      case "run.get":
        return ok(command.type, board().workflows.getRun(command.payload.runId));
      case "gate.respond": {
        const { runId, stepId, attempt, decision, note } = command.payload;
        board().workflows.respond(runId, stepId, attempt, decision, note);
        return ok(command.type, board().workflows.getRun(runId));
      }
      case "rules.list":
        return ok(command.type, { rules: board().listRules(command.payload.projectId) });
      case "rules.remove": {
        const { projectId, rule, confirm } = command.payload;
        return ok(command.type, { rules: board().removeRule(projectId, rule, confirm === true) });
      }
      case "costs.status":
        return ok(command.type, costs().status());
      case "costs.reprice":
        return ok(command.type, costs().reprice());
      case "costs.summary":
        return ok(command.type, costs().summary(command.payload));
      case "telemetry.session":
        return ok(command.type, telemetry().timeline(command.payload.claudeSessionId));
      case "bg.list":
        return ok(command.type, await bg().list());
      case "bg.stop":
        return ok(command.type, await bg().stop(command.payload.id));
      case "bg.respawn":
        return ok(command.type, await bg().respawn(command.payload.id));
      case "bg.message":
        return ok(command.type, await bg().message(command.payload.id, command.payload.text));
      case "trace.get":
        return ok(command.type, trace().get(command.payload.claudeSessionId));
      case "trace.export": {
        const { claudeSessionId, includeContent } = command.payload;
        return ok(command.type, trace().export(claudeSessionId, includeContent === true));
      }
      case "telemetry.status":
        return ok(command.type, optIn().status());
      case "telemetry.install":
        return ok(command.type, optIn().install(command.payload.confirm === true));
      case "telemetry.uninstall":
        return ok(command.type, optIn().uninstall(command.payload.confirm === true));
      case "telemetry.summary":
        return ok(command.type, telemetry().summary());
      case "costs.session":
        return ok(command.type, costs().session(command.payload.claudeSessionId));
      case "costs.sessions":
        return ok(command.type, { costs: costs().sessions(command.payload.claudeSessionIds) });
      case "costs.card":
        return ok(command.type, { costUsd: costs().card(command.payload.cardId) });
      case "costs.run":
        return ok(command.type, { costUsd: costs().run(command.payload.runId) });
      case "costs.export":
        return ok(command.type, costs().export(command.payload));
      case "budget.list":
        return ok(command.type, { budgets: budgets().list() });
      case "budget.set":
        return ok(command.type, budgets().set(command.payload));
      case "budget.remove":
        budgets().remove(command.payload.id);
        return ok(command.type);
      case "budget.watch": {
        const host = budgets();
        ws.data.unwatchBudgets?.();
        ws.data.unwatchBudgets = host.watch((update) =>
          send(ws, { type: "budget.updated", ...update }),
        );
        return ok(command.type);
      }
      case "files.sessions":
        return ok(command.type, { sessions: sessionFiles().sessionsOf(command.payload.path) });
      case "fs.dirs": {
        const { path, hidden } = command.payload;
        return ok(
          command.type,
          listDirs(path, opts.allowedRoots, hidden === undefined ? {} : { hidden }),
        );
      }
      case "session.files":
        return ok(command.type, { files: sessionFiles().list(command.payload.claudeSessionId) });
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
      case "terminal.open": {
        const { cwd, command: argv, claude, cols, rows } = command.payload;
        return ok(
          command.type,
          terminals().open({
            cwd,
            ...(argv ? { command: argv } : {}),
            ...(claude ? { claude } : {}),
            cols,
            rows,
          }),
        );
      }
      case "terminal.write":
        terminals().write(command.payload.terminalId, command.payload.data);
        return ok(command.type);
      case "terminal.resize":
        terminals().resize(command.payload.terminalId, command.payload.cols, command.payload.rows);
        return ok(command.type);
      case "terminal.attach":
        return ok(
          command.type,
          terminals().attach(
            command.payload.terminalId,
            terminalSink(ws),
            command.payload.flow === true,
          ),
        );
      case "terminal.ack":
        terminals().ack(command.payload.terminalId, terminalSink(ws), command.payload.bytes);
        return ok(command.type);
      case "terminal.detach":
        terminals().detach(command.payload.terminalId, terminalSink(ws));
        return ok(command.type);
      case "terminal.close":
        terminals().close(command.payload.terminalId, command.payload.kill, terminalSink(ws));
        return ok(command.type);
      case "terminal.list":
        return ok(command.type, { terminals: terminals().list() });
      case "terminal.settings": {
        const { enabled, confirm } = command.payload;
        const manager = terminals();
        if (enabled && !manager.enabled && confirm !== true) {
          throw new FlightdeckError(
            "invalid_state",
            "ligar o terminal dá um shell completo neste host: confirme com confirm: true",
          );
        }
        manager.setEnabled(enabled);
        opts.onTerminalSettings?.(enabled);
        return ok(command.type, manager.settings());
      }
      case "pr.comments":
        return ok(command.type, { comments: await board().prComments(command.payload.cardId) });
      case "pr.comments.send": {
        const { cardId, ids } = command.payload;
        return ok(command.type, await board().sendPrComments(cardId, ids));
      }
      case "card.updateFromBase":
        return ok(command.type, await board().updateFromBase(command.payload.cardId));
      case "card.mergeLocal": {
        const { cardId, mode, confirm } = command.payload;
        return ok(command.type, await board().mergeLocal(cardId, mode, confirm === true));
      }
      case "changes.get":
        return ok(command.type, await changes().get(command.payload.target));
      case "changes.watch": {
        const { target } = command.payload;
        const stop = await changes().watch(target, (result) =>
          send(ws, { type: "changes.updated", ...result }),
        );
        ws.data.changeWatchers.get(target)?.();
        ws.data.changeWatchers.set(target, stop);
        return ok(command.type);
      }
      case "changes.unwatch":
        ws.data.changeWatchers.get(command.payload.target)?.();
        ws.data.changeWatchers.delete(command.payload.target);
        return ok(command.type);
      case "ssh.list":
        return ok(command.type, { targets: ssh().list() });
      case "ssh.save":
        return ok(command.type, ssh().save(command.payload));
      case "ssh.remove":
        ssh().remove(command.payload.id, command.payload.confirm);
        return ok(command.type);
      case "snippets.list":
        return ok(command.type, snippets().list(command.payload));
      case "snippets.save":
        return ok(command.type, snippets().save(command.payload));
      case "snippets.get": {
        const { id, name, projectPath } = command.payload;
        return ok(
          command.type,
          id ? snippets().get(id) : snippets().find(name as string, projectPath),
        );
      }
      case "snippets.remove":
        snippets().remove(command.payload.id);
        return ok(command.type);
      case "snippets.trust":
        return ok(
          command.type,
          snippets().trust(command.payload.projectPath, command.payload.hash),
        );
      case "snippets.favorite":
        return ok(command.type, snippets().favorite(command.payload.id, command.payload.favorite));
      case "snippets.parse":
        return ok(command.type, snippets().parse(command.payload.text));
      case "snippets.importHistory": {
        const { limit, reveal, select } = command.payload;
        const importer = snippetHistory();
        const done = select ? importer.import(select) : { created: [], skipped: [] };
        const preview = importer.preview({
          ...(limit ? { limit } : {}),
          ...(reveal ? { reveal } : {}),
        });
        return ok(command.type, { ...preview, ...done });
      }
      case "personas.list":
        return ok(command.type, personas().list(command.payload));
      case "personas.save":
        return ok(command.type, personas().save(command.payload));
      case "session.applyPersona": {
        const { sessionId, claudeSessionId, persona } = command.payload;
        return ok(
          command.type,
          await personaSessions().apply({ sessionId, claudeSessionId, persona }),
        );
      }
      case "session.clearPersona":
        return ok(command.type, await personaSessions().clear(command.payload));
      case "personas.subagents": {
        const { projectPath, language } = command.payload;
        return ok(command.type, personas().subagents({ projectPath, language }));
      }
      case "personas.publishAgent":
        return ok(command.type, personas().publishAgent(command.payload));
      case "personas.resolve": {
        const { ref, projectPath } = command.payload;
        const store = personas();
        try {
          return ok(command.type, store.resolve(ref, { projectPath, language: ref.language }));
        } catch (error) {
          // A folder the daemon does not allow has no personas of its own: the host's and the pack's apply.
          if (projectPath && error instanceof FlightdeckError && error.code === "forbidden_cwd") {
            return ok(command.type, store.resolve(ref, { language: ref.language }));
          }
          throw error;
        }
      }
      case "personas.reset":
        return ok(
          command.type,
          personas().reset(command.payload.id, { language: command.payload.language }),
        );
      case "personas.remove":
        personas().remove(command.payload.scope, command.payload.id, command.payload.projectPath);
        return ok(command.type);
      case "personas.trust":
        return ok(
          command.type,
          personas().trust(command.payload.projectPath, command.payload.id, command.payload.hash),
        );
      case "snippets.render":
        return ok(command.type, await snippetUse().render(command.payload));
      case "snippets.use":
        return ok(command.type, await snippetUse().use(command.payload));
      case "askpass.watch":
        ws.data.unwatchAskpass?.();
        ws.data.unwatchAskpass = askpass().watch((frame) => send(ws, frame));
        return ok(command.type);
      case "askpass.ask":
        return ok(command.type, {
          secret: await askpass().ask(command.payload.ticket, command.payload.prompt),
        });
      case "askpass.answer":
        askpass().answer(command.payload.requestId, command.payload.secret);
        return ok(command.type);
      case "ssh.connect": {
        const { targetId, cols, rows, privateKey } = command.payload;
        // A key from the vault travels only where the vault delivers: loopback and Tailscale.
        if (privateKey) requireVaultTransport(ws.data.origin, "ssh.connect com chave", opts.log);
        const request = { targetId, cols, rows, ...(privateKey ? { privateKey } : {}) };
        return ok(command.type, await sshConnect().connect(request));
      }
      case "ssh.test": {
        const { targetId, privateKey } = command.payload;
        if (privateKey) requireVaultTransport(ws.data.origin, "ssh.test com chave", opts.log);
        return ok(
          command.type,
          await sshConnect().test({ targetId, ...(privateKey ? { privateKey } : {}) }),
        );
      }
      case "ssh.hostkey.check":
        return ok(command.type, await sshHostKeys().check(command.payload.targetId));
      case "ssh.hostkey.confirm":
        return ok(
          command.type,
          sshHostKeys().confirm(command.payload.targetId, command.payload.fingerprint),
        );
      case "ssh.hostkey.forget":
        return ok(command.type, sshHostKeys().forget(command.payload.targetId));
      case "ssh.import.preview":
        return ok(command.type, sshImport().preview());
      case "ssh.import.apply":
        return ok(command.type, sshImport().apply(command.payload.aliases));
      case "review.list":
        return ok(command.type, { comments: await review().list(command.payload.target) });
      case "review.add":
        return ok(command.type, await review().add(command.payload));
      case "review.update":
        return ok(command.type, await review().update(command.payload.id, command.payload.body));
      case "review.remove":
        review().remove(command.payload.id);
        return ok(command.type);
      case "review.send":
        return ok(command.type, await review().send(command.payload.target));
      case "changes.revert": {
        const { target, path, confirm } = command.payload;
        return ok(command.type, await files().revert(target, path, confirm === true));
      }
      case "changes.undoRevert": {
        const { target, path, confirm } = command.payload;
        return ok(command.type, await files().undoRevert(target, path, confirm === true));
      }
      case "file.read":
        return ok(command.type, await files().read(command.payload.target, command.payload.path));
      case "file.write": {
        const { target, path, text, expectedHash } = command.payload;
        return ok(command.type, await files().write(target, path, text, expectedHash));
      }
      case "quota.history":
        return ok(
          command.type,
          quotaHistory().history(command.payload.window, command.payload.hours),
        );
      case "usage.summary":
        return ok(command.type, usage().summary(command.payload.days));
      case "quota.get":
        return ok(command.type, quota().state());
      case "quota.watch": {
        const host = quota();
        ws.data.unwatchQuota?.();
        ws.data.unwatchQuota = host.watch((state) => send(ws, { type: "quota.updated", ...state }));
        return ok(command.type);
      }
      case "runenv.config":
        return ok(
          command.type,
          await runenv().configs.info(board().getProject(command.payload.projectId)),
        );
      case "runenv.trust": {
        const { projectId, hash } = command.payload;
        return ok(command.type, await runenv().configs.trust(board().getProject(projectId), hash));
      }
      case "runenv.start":
        return ok(command.type, await runenv().manager.start(command.payload.cardId));
      case "runenv.stop":
        return ok(command.type, await runenv().manager.stop(command.payload.cardId));
      case "runenv.get":
        return ok(command.type, runenv().manager.state(command.payload.cardId));
      case "runenv.watch": {
        // Ack, the runs going now, then every change.
        const { manager } = runenv();
        ws.data.unwatchRunEnv?.();
        ws.data.unwatchRunEnv = manager.watch((state) =>
          send(ws, { type: "runenv.updated", state }),
        );
        ok(command.type);
        for (const state of manager.live()) send(ws, { type: "runenv.updated", state });
        return;
      }
      case "run.watch": {
        // Ack, the runs still going, then every change: the app sees open gates right away.
        const runs = board().workflows;
        ws.data.unwatchRuns?.();
        ws.data.unwatchRuns = runs.watch((run) => send(ws, { type: "run.updated", run }));
        ok(command.type);
        for (const run of runs.activeRuns()) send(ws, { type: "run.updated", run });
        return;
      }
      case "card.start": {
        const { cardId, workflow, inputs, persona } = command.payload;
        return ok(command.type, await board().startCard(cardId, { workflow, inputs, persona }));
      }
      case "card.stop":
        return ok(command.type, await board().stopCard(command.payload.cardId));
      case "card.diff":
        return ok(command.type, await board().diff(command.payload.cardId));
      case "card.message":
        return ok(command.type, board().message(command.payload.cardId, command.payload.text));
      case "card.pr.create":
        return ok(
          command.type,
          await board().createPr(command.payload.cardId, {
            ...(command.payload.description === undefined
              ? {}
              : { description: command.payload.description }),
          }),
        );
      case "card.complete": {
        const { cardId, confirm } = command.payload;
        return ok(command.type, await board().completeCard(cardId, confirm === true));
      }
      case "card.discard": {
        const { cardId, confirm } = command.payload;
        return ok(command.type, await board().discardCard(cardId, confirm === true));
      }
      case "sessions.watch": {
        // Same pattern as subscribe: ack, current summaries, then live ones, with no gap.
        ws.data.unwatch?.();
        const watch = manager.watchSummaries((envelope) => send(ws, envelope));
        ws.data.unwatch = watch.unwatch;
        ok(command.type);
        for (const envelope of watch.snapshot) send(ws, envelope);
        return;
      }
    }
  }

  async function onCommand(ws: Socket, frame: unknown): Promise<void> {
    const header = CommandHeader.safeParse(frame);
    const id = header.success ? header.data.id : "";
    const parsed = Command.safeParse(frame);
    if (!parsed.success) {
      return ackError(ws, id, "bad_request", z.prettifyError(parsed.error));
    }
    try {
      await dispatch(ws, parsed.data);
    } catch (error) {
      if (error instanceof FlightdeckError)
        return ackError(ws, id, error.code, error.message, error);
      console.error(`[flightdeckd] erro em ${parsed.data.type}:`, error);
      ackError(ws, id, "internal", "erro interno do daemon");
    }
  }

  const server = Bun.serve<Connection>({
    hostname: opts.bind,
    port: opts.port,
    fetch(req, srv) {
      // Origin filter before anything else, on every route, before any upgrade.
      const origin = srv.requestIP(req)?.address ?? "";
      if (!ipInNetworks(origin, opts.allowedNetworks ?? DEFAULT_ALLOWED_NETWORKS)) {
        return new Response("forbidden", { status: 403 });
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
        let frame: unknown;
        try {
          frame = decode(raw);
        } catch {
          if (!ws.data.authed) return unauthorized(ws);
          return ackError(ws, "", "bad_request", "JSON inválido");
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
        ws.data.unwatchAskpass?.();
        ws.data.unwatchBudgets?.();
        if (ws.data.terminalSink) opts.terminals?.detachAll(ws.data.terminalSink);
        for (const stop of ws.data.changeWatchers.values()) stop();
        ws.data.changeWatchers.clear();
        ws.data.unwatchVault?.();
        ws.data.unwatchMessages?.();
        ws.data.unwatchTeams?.();
        ws.data.unwatchPrs?.();
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
      clearInterval(heartbeat);
      opts.plugins?.close();
      return server.stop(true);
    },
  };
}
