import type {
  AskpassRequest,
  Budget,
  BudgetInput,
  BudgetUpdated,
  Card,
  ChangesUpdated,
  CommandPayload,
  CommandResults,
  CommandType,
  EventEnvelope,
  ExternalPermissionFrame,
  ExternalSession,
  ExternalUpdated,
  HelloResult,
  HistoryChanged,
  HistoryGetResult,
  HistoryListResult,
  HistorySearchHit,
  HistorySessionSummary,
  HostInfoResult,
  PendingPermission,
  PermissionUpdate,
  Project,
  QuotaState,
  RiskLevel,
  SessionEventOf,
  SessionMeta,
  SessionStatus,
  SessionSubscribeResult,
  SessionSummary,
  SshTarget,
  TerminalInfo,
  VaultRequestFrame,
  WorkflowRun,
} from "@flightdeck/protocol";
import { formatDateTime, formatTime, formatWhen } from "../i18n/format.ts";
import { I18n, type Key } from "../i18n/index.ts";
import type { AppUpdate, Platform, TrayAction, TrayStatus } from "../platform/types.ts";
import { budgetLabel } from "./budgets.ts";
import { localDay, usd } from "./costs.ts";
import { DensityController } from "./density.ts";
import { type ConnectionStatus, HostConnection, RequestError } from "./host-connection.ts";
import { type HostConfig, loadHosts, saveHosts } from "./hosts.ts";
import { type HubFilter, loadHubFilter, saveHubFilter } from "./hub.ts";
import { LIST_WIDTH_KEY, loadListWidth } from "./list-width.ts";
import { summaryNotifications } from "./notify.ts";
import { basename } from "./paths.ts";
import { probeHost } from "./probe-host.ts";
import { isHot } from "./quota.ts";
import { parseRequestLink, requestLink } from "./request-link.ts";
import { applyEnvelope, emptySession, endStreaming, type SessionState } from "./session-state.ts";
import { DEFAULT_SHORTCUT, SHORTCUT_KEY, validateShortcut } from "./shortcut.ts";
import { savePayload } from "./ssh.ts";
import type { Navigation, Tabs } from "./tabs.ts";
import {
  type TerminalEnv,
  type TerminalLaunch,
  type TerminalTarget,
  terminalLaunch,
} from "./terminal.ts";
import type { TerminalHost } from "./terminal-session.ts";
import { TerminalFontController } from "./terminal-view.ts";
import { ThemeController } from "./theme.ts";
import { TRAY_MENU_DELAY_MS, trayMenu, trayStatus } from "./tray.ts";
import { type NewKey, type NewSecret, type SecretMeta, type SecretPatch, Vault } from "./vault.ts";
import { actionPolicy } from "./vault-approval.ts";
import {
  applyImport,
  BackupError,
  type BackupErrorCode,
  type ConflictChoice,
  exportVault,
  fromFdvault,
  type ImportPreview,
  type ImportResult,
  previewImport,
  toFdvault,
} from "./vault-backup.ts";
import {
  answerVaultRequest,
  checkDelivery,
  type DeliveryRefusal,
  type VaultOutcome,
  type VaultPolicy,
  type VaultRequestContext,
} from "./vault-requests.ts";
import { type UsageEntry, VaultUsageLog } from "./vault-usage.ts";
import { hasFeature } from "./version.ts";
import { WORKSPACE_KEY, Workspace } from "./workspace.ts";

/** What the sidebar knows about a session, straight from `session.summary`. */
export interface SidebarSession {
  id: string;
  name: string | null;
  cwd: string;
  status: SessionStatus;
  pendingPermissions: PendingPermission[];
  updatedAt: string;
}

export interface HostView extends HostConfig {
  status: ConnectionStatus;
  info: HelloResult | null;
  /** From `host.info`, fetched on each connect; `null` until then or on daemons without it. */
  hostInfo: HostInfoResult | null;
  /** Round trip of the last heartbeat. */
  latencyMs: number | null;
  /** Why the daemon refused this app's protocol, while `status` is `incompatible`. */
  incompatibility: string | null;
  /** Phase 9: an update of the daemon asked from the app, until it comes back on `target`. */
  daemonUpdate: { target: string; failed: string | null } | null;
  sessions: SidebarSession[];
}

export interface Selection {
  hostId: string;
  sessionId: string | null;
}

export interface AppState {
  hosts: HostView[];
  /** Keyed by `sessionKey(hostId, sessionId)`. */
  sessions: Record<string, SessionState>;
  selected: Selection | null;
  error: string | null;
  settings: Settings;
  /** Last global history search, `null` before the first one. */
  search: SearchState | null;
  searchOpen: boolean;
  /** A terminal tab whose close waits for the user to say detach or end (phase 14). */
  closingTerminal: { areaId: string; tabId: string } | null;
  /** Sessions that replied while no tab showed them (phase 14), by session key. */
  unread: Record<string, true>;
  /** Board cards seen so far, keyed by `sessionKey(hostId, cardId)`; kept by `card.updated`. */
  cards: Record<string, Card>;
  /** Sessions opened outside Flightdeck, by `sessionKey(hostId, claudeSessionId)`. */
  externals: Record<string, ExternalSession>;
  /** Open permission requests of external sessions, by `sessionKey(hostId, requestId)`. */
  externalRequests: Record<string, ExternalPermissionFrame>;
  /** Name, pinned and archived, by `sessionKey(hostId, claudeSessionId)`. */
  meta: Record<string, SessionMeta>;
  /** Plan quota of each host, by host id; kept by `quota.updated`. */
  quota: Record<string, QuotaState>;
  /** Budgets of each host, by host id; kept by `budget.updated` (phase 8). */
  budgets: Record<string, Budget[]>;
  /** The ssh password or passphrase prompts waiting for an answer, oldest first (phase 15). */
  askpass: Array<{ hostId: string; request: AskpassRequest }>;
  /** The ssh destinos of each host that keeps them, by host id; read when the palette opens (phase 15). */
  ssh: Record<string, SshTarget[]>;
  /** Phase 16: the vault's list, metadata only (a value is only read to be delivered). */
  secrets: SecretMeta[];
  /** Phase 16: the vault's usage log, newest first; never holds a value. */
  vaultUsage: UsageEntry[];
  /** Phase 17: the daemon's requests for a secret, waiting for the user; they join the queue. */
  vaultApprovals: PendingItem[];
  /** Workflow runs seen so far, by `sessionKey(hostId, runId)`; kept by `run.updated`. */
  runs: Record<string, WorkflowRun>;
  /** Managed and history lists of each host for the Sessões screen. */
  hub: Record<string, { managed: SessionSummary[]; history: HistorySessionSummary[] }>;
  /** This machine's terminals (phase 8), probed at init; `null` where none can be opened. */
  terminalEnv: TerminalEnv | null;
  /** Toasts still to show or still open (phase 10). */
  notices: Notice[];
  /** Projects of each host, loaded for the Ctrl+K palette (phase 8). */
  projects: Record<string, Project[]>;
  /** The saved hosts are in `hosts` (init done with them); routes wait for it (phase 10). */
  hostsLoaded: boolean;
  /** Phase 9: the app's own update. */
  appUpdate: AppUpdateState;
}

export interface AppUpdateState {
  /** A newer version on offer (hidden again by "Depois"). */
  offer: AppUpdate | null;
  /** The last check found nothing newer. */
  upToDate: boolean;
  /** Why the last check or install failed. */
  error: string | null;
}

/** How often the app looks for its own update while open. */
const APP_UPDATE_INTERVAL_MS = 6 * 3_600_000;

/** Commands sent through `hostCommand`: board (phase 4), hooks, external sessions and meta (phase 5), checkpoints and the agent's config (phase 12). */
/** What a host's terminals say to the one following them. */
export interface TerminalListener {
  data(base64: string): void;
  exited(exitCode: number): void;
  resync(): void;
  offline(): void;
}

/** The terminal commands of one host. */
export interface TerminalCommands extends TerminalHost {
  open(cwd: string, cols: number, rows: number): Promise<{ terminalId: string }>;
  list(): Promise<TerminalInfo[]>;
}

export type HostCommandType = Extract<
  CommandType,
  | `terminal.${string}`
  | `ssh.${string}`
  | `askpass.${string}`
  | `project.${string}`
  | `board.${string}`
  | `card.${string}`
  | `hooks.${string}`
  | `external.${string}`
  | "session.meta.set"
  | `workflow.${string}`
  | `run.${string}`
  | `gate.${string}`
  | `maintenance.${string}`
  | `quota.${string}`
  | `usage.${string}`
  | `rules.${string}`
  | `costs.${string}`
  | `budget.${string}`
  | `changes.${string}`
  | `review.${string}`
  | `file.${string}`
  | "vault.deliver"
  | "vault.deny"
  | `pr.${string}`
  | "files.sessions"
  | "session.files"
  | `snapshots.${string}`
  | `rewind.${string}`
  | "session.fork"
  | `mcp.${string}`
  | `agentcfg.${string}`
  | `issues.${string}`
  | `automation.${string}`
  | `autoapprove.${string}`
  | `actions.${string}`
>;

/** A command's answer kept apart from the error banner: the caller decides what to show. */
export type HostResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

const isRun = (value: unknown): value is WorkflowRun =>
  typeof value === "object" && value !== null && "workflowName" in value && "steps" in value;

const isCard = (value: unknown): value is Card =>
  typeof value === "object" && value !== null && "column" in value && "projectId" in value;

/** Cards inside a command result: a card, a whole board or none. */
function cardsIn(result: unknown): Card[] {
  if (isCard(result)) return [result];
  const columns = (result as { columns?: Array<{ cards: Card[] }> } | undefined)?.columns ?? [];
  return columns.flatMap((column) => column.cards);
}

export interface GlobalHit extends HistorySearchHit {
  hostId: string;
  hostName: string;
}

export interface SearchState {
  query: string;
  /** Every host's hits so far, newest first. */
  hits: GlobalHit[];
  /** Hosts still being asked. */
  waiting: string[];
  /** Hosts that were offline or did not answer in time. */
  silent: string[];
}

export interface Settings {
  closeToTray: boolean;
  autostart: boolean;
  autostartSupported: boolean;
  /** Accelerator in use (or tried last, when `shortcutProblem` is set). */
  globalShortcut: string;
  globalShortcutSupported: boolean;
  /** The OS refused the shortcut, typically because another program already uses it. */
  shortcutProblem: string | null;
  /** The last shortcut typed in the settings was not valid. */
  shortcutError: string | null;
  /** Phase 9: look for app updates at startup and every 6 h. */
  notifyUpdates: boolean;
  updaterSupported: boolean;
}

export interface AppStoreOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** How long the global search waits for each host. */
  searchTimeoutMs?: number;
  /** Milliseconds now: the age of quota readings. */
  now?: () => number;
  /** HH:MM of an instant (quota resets); the host machine's time zone when absent. */
  formatTime?: (iso: string) => string;
  /** IANA time zone of the dates shown (the machine's when absent); tests pin one. */
  timeZone?: string;
  /** Timers of the tray submenu's debounce (phase 8); the real ones when absent. */
  timers?: {
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  /** `YYYY-MM-DD` of an instant (cost periods); this machine's time zone when absent. */
  day?: (ms: number) => string;
  /** How long a host may take to come back on the new daemon version (2 min when absent). */
  daemonUpdateTimeoutMs?: number;
  /** How often the app looks for its own update while open (6 h when absent). */
  appUpdateIntervalMs?: number;
  /** Phase 16: decides a `vault.request` of the daemon; denies them all when absent. */
  vaultPolicy?: VaultPolicy;
  /** scrypt work factor (log2 N) of an exported vault; tests lower it to stay fast. */
  vaultWorkFactor?: number;
}

/** A toast: a host's error (by code, the daemon's message as detail) or a short success. */
export interface Notice {
  id: number;
  kind: "error" | "success";
  /** The daemon's error code; "" for an app-side error or a success. */
  code: string;
  text: string;
}

export interface PendingItem {
  hostId: string;
  hostName: string;
  sessionId: string;
  sessionName: string;
  requestId: string;
  toolName: string;
  createdAt: string;
  /** A request of a session opened outside Flightdeck (`sessionId` is its claudeSessionId). */
  external?: boolean;
  /** The tool input, long strings cut (phase 8: the tray shows a summary). */
  input?: Record<string, unknown>;
  /** The session's folder (phase 10: the queue's card makes paths relative to it). */
  cwd?: string | null;
  /** An open gate of a workflow run (`sessionId` is the card), answered with `gate.respond`. */
  gate?: GateRef;
  /** Phase 13: the risk the daemon judged for the request; an older daemon sends none. */
  risk?: RiskLevel;
  riskReason?: string;
  /** Phase 17: the daemon asks for a secret to run an action or a free command. */
  vault?: true;
}

export interface GateRef {
  runId: string;
  stepId: string;
  attempt: number;
  cardId: string;
}

/** The window kept by the last run; nothing (a fresh window) when it is missing or unreadable. */
function storedWorkspace(storage: Platform["storage"]): unknown {
  try {
    return JSON.parse(storage.getItem(WORKSPACE_KEY) ?? "null");
  } catch {
    return null;
  }
}

/** Every open permission request of every host, oldest first. */
export function needsYou(state: AppState): PendingItem[] {
  const requests: PendingItem[] = state.hosts.flatMap((host) => [
    ...host.sessions.flatMap((session) =>
      session.pendingPermissions.map((p) => ({
        hostId: host.id,
        hostName: host.name,
        sessionId: session.id,
        sessionName: session.name ?? basename(session.cwd),
        requestId: p.requestId,
        toolName: p.toolName,
        createdAt: p.createdAt,
        ...(p.input ? { input: p.input } : {}),
        ...(p.risk ? { risk: p.risk } : {}),
        ...(p.riskReason ? { riskReason: p.riskReason } : {}),
        cwd: session.cwd,
      })),
    ),
    // Sessions opened in the terminal: the hook holds the request while the app watches.
    ...Object.entries(state.externalRequests)
      .filter(([key]) => key.startsWith(`${host.id}/`))
      .map(([, request]) => {
        const id = request.claudeSessionId;
        const session = state.externals[sessionKey(host.id, id)];
        const name = state.meta[sessionKey(host.id, id)]?.name;
        return {
          hostId: host.id,
          hostName: host.name,
          sessionId: id,
          sessionName: name ?? basename(session?.cwd ?? id),
          requestId: request.requestId,
          toolName: request.toolName,
          createdAt: request.createdAt,
          external: true,
          input: request.input,
          ...(request.risk ? { risk: request.risk } : {}),
          ...(request.riskReason ? { riskReason: request.riskReason } : {}),
          cwd: session?.cwd ?? null,
        };
      }),
    // Open gates of the host's workflow runs.
    ...Object.entries(state.runs)
      .filter(([key]) => key.startsWith(`${host.id}/`))
      .flatMap(([, run]) =>
        run.steps
          .filter((step) => step.type === "gate" && step.status === "waiting")
          .map((step) => ({
            hostId: host.id,
            hostName: host.name,
            sessionId: run.cardId,
            sessionName: state.cards[sessionKey(host.id, run.cardId)]?.title ?? run.workflowName,
            requestId: `gate:${run.id}/${step.stepId}/${step.attempt}`,
            toolName: `gate ${step.stepId}`,
            createdAt: step.startedAt,
            gate: {
              runId: run.id,
              stepId: step.stepId,
              attempt: step.attempt,
              cardId: run.cardId,
            },
          })),
      ),
  ]);
  const known = state.vaultApprovals.filter((item) =>
    state.hosts.some((h) => h.id === item.hostId),
  );
  return [...requests, ...known].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Filters of the per-host history list. */
export type HistoryFilter = Omit<CommandPayload<"history.list">, "cursor" | "limit">;

/** Sessions shown by the per-host history list (the newest ones; filters narrow it down). */
export const HISTORY_LIST_LIMIT = 200;

/** Messages per `history.get` page in the transcript reader. */
export const HISTORY_PAGE = 50;

/** Preference stored in plain settings; anything but "false" means on. */
export const CLOSE_TO_TRAY_KEY = "flightdeck.closeToTray";
export const NOTIFY_UPDATES_KEY = "flightdeck.notifyUpdates";

export const sessionKey = (hostId: string, sessionId: string) => `${hostId}/${sessionId}`;

const REAL_TIMERS = {
  setTimeout: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const newHostView = (config: HostConfig): HostView => ({
  ...config,
  status: "offline",
  info: null,
  hostInfo: null,
  latencyMs: null,
  incompatibility: null,
  daemonUpdate: null,
  sessions: [],
});

/** Rejects when `promise` (absent when the host has no connection) takes longer than `ms`. */
function withTimeout<T>(promise: Promise<T> | undefined, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("sem resposta")), ms);
  });
  return Promise.race([promise ?? Promise.reject(new Error("sem conexão")), timeout]).finally(() =>
    clearTimeout(timer),
  );
}

/** A request whose failure only means less to show (an older daemon, a host without a board). */
const quiet = <T>(promise: Promise<T>) => promise.catch(() => null);

function describeError(error: unknown): string {
  return error instanceof RequestError ? `${error.code}: ${error.message}` : String(error);
}

/**
 * All app state in one framework-free store: hosts and their connections, session timelines and
 * the current selection. React reads it through `useSyncExternalStore`.
 */
export class AppStore {
  private state: AppState;
  private readonly listeners = new Set<() => void>();
  private readonly connections = new Map<string, HostConnection>();
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private tray: TrayStatus | null = null;
  private searchSeq = 0;
  private noticeSeq = 0;
  /** Quota windows already notified, by host, window and reset. */
  private readonly quotaNotified = new Set<string>();
  private readonly historyListeners = new Set<(hostId: string, change: HistoryChanged) => void>();
  /** Who watches each review target's diff (phase 11), by `hostId|target`. */
  private readonly terminalListeners = new Map<string, Set<TerminalListener>>();
  private readonly changeListeners = new Map<string, Set<(update: ChangesUpdated) => void>>();
  /** Accelerator currently registered with the OS. */
  private shortcut: string | null = null;
  /** The tray submenu last sent, and the debounce that will send the next one (phase 8). */
  private trayMenuSent = JSON.stringify(trayMenu([]));
  private trayMenuTimer: unknown = null;
  private offTrayAction: (() => void) | null = null;
  private readonly openRequestListeners = new Set<(item: PendingItem) => void>();

  constructor(
    private readonly platform: Platform,
    private readonly options: AppStoreOptions = {},
  ) {
    this.workspace = Workspace.restore(storedWorkspace(platform.storage));
    this.router = this.workspace.router;
    this.workspace.subscribe(() => {
      platform.storage.setItem(WORKSPACE_KEY, JSON.stringify(this.workspace.snapshot()));
      this.clearShownUnread();
    });
    this.workspace.subscribe(() =>
      platform.storage.setItem(WORKSPACE_KEY, JSON.stringify(this.workspace.snapshot())),
    );
    this.vault = new Vault(platform);
    this.usage = new VaultUsageLog(platform);
    this.theme = new ThemeController(platform);
    this.density = new DensityController(platform.storage);
    this.terminalFont = new TerminalFontController(platform.storage);
    this.i18n = new I18n(platform);
    this.i18n.subscribe(() => this.onLanguage());
    this.state = {
      hosts: [],
      sessions: {},
      selected: null,
      error: null,
      search: null,
      searchOpen: false,
      closingTerminal: null,
      unread: {},
      cards: {},
      runs: {},
      quota: {},
      budgets: {},
      ssh: {},
      askpass: [],
      secrets: new Vault(platform).list(),
      vaultUsage: this.usage.list(),
      vaultApprovals: [],
      externals: {},
      externalRequests: {},
      meta: {},
      hub: {},
      terminalEnv: null,
      projects: {},
      notices: [],
      hostsLoaded: false,
      appUpdate: { offer: null, upToDate: false, error: null },
      // Defaults: close to tray on, start with Windows off.
      settings: {
        closeToTray: true,
        autostart: false,
        autostartSupported: platform.autostart.supported,
        globalShortcut: DEFAULT_SHORTCUT,
        globalShortcutSupported: platform.globalShortcut.supported,
        shortcutProblem: null,
        shortcutError: null,
        notifyUpdates: true,
        updaterSupported: platform.updater.supported,
      },
    };
  }

  /** Light, dark or the system's (phase 10). */
  readonly theme: ThemeController;
  readonly density: DensityController;
  readonly terminalFont: TerminalFontController;
  /** pt-BR or English, and the translator (phase 10). */
  readonly i18n: I18n;
  /** The screen in use and its history (phase 10). */
  readonly workspace: Workspace;
  readonly router: Navigation;

  /** The focused area's tabs. */
  get tabs(): Tabs {
    return this.workspace.tabs;
  }

  getState = (): AppState => this.state;

  /** Milliseconds now (injected in tests). */
  now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** Today as `YYYY-MM-DD`, in this machine's time zone unless injected. */
  today(): string {
    return (this.options.day ?? localDay)(this.now());
  }

  /** HH:MM of an instant, in this machine's time zone unless injected. */
  formatTime(iso: string): string {
    if (this.options.formatTime) return this.options.formatTime(iso);
    return formatTime(iso, this.i18n.lang, this.options.timeZone);
  }

  /** Date and time of an instant in local time, in the app's language (phase 10). */
  formatDateTime(iso: string): string {
    return Number.isNaN(Date.parse(iso))
      ? ""
      : formatDateTime(iso, this.i18n.lang, this.options.timeZone);
  }

  /** A list's short time: HH:MM today, the day and month before (phase 10). */
  formatWhen(iso: string): string {
    return Number.isNaN(Date.parse(iso))
      ? ""
      : formatWhen(iso, this.now(), this.i18n.lang, this.options.timeZone);
  }

  /** The list column's width, kept across starts (phase 10). */
  listWidth(): number {
    return loadListWidth(this.platform.storage);
  }

  setListWidth(width: number): void {
    this.platform.storage.setItem(LIST_WIDTH_KEY, String(width));
  }

  /** The hub's saved filters (phase 10). */
  hubFilter(): HubFilter {
    return loadHubFilter(this.platform.storage);
  }

  saveHubFilter(filter: HubFilter): void {
    saveHubFilter(this.platform.storage, filter);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async init(): Promise<void> {
    // Reset synchronously first: nothing from a previous init may stay visible while awaiting.
    this.dispose();
    this.theme.start();
    this.i18n.start();
    this.update({
      hosts: [],
      hostsLoaded: false,
      sessions: {},
      selected: null,
      cards: {},
      runs: {},
      quota: {},
    });
    const closeToTray = this.platform.storage.getItem(CLOSE_TO_TRAY_KEY) !== "false";
    await this.platform.setCloseToTray(closeToTray);
    const autostart =
      this.platform.autostart.supported && (await this.platform.autostart.isEnabled());
    const globalShortcut = this.platform.storage.getItem(SHORTCUT_KEY) ?? DEFAULT_SHORTCUT;
    const notifyUpdates = this.platform.storage.getItem(NOTIFY_UPDATES_KEY) !== "false";
    this.update({
      settings: { ...this.state.settings, closeToTray, autostart, globalShortcut, notifyUpdates },
    });
    if (this.platform.updater.supported && notifyUpdates) {
      void this.checkAppUpdate();
      this.updateTimer = setInterval(() => {
        if (this.state.settings.notifyUpdates) void this.checkAppUpdate();
      }, this.options.appUpdateIntervalMs ?? APP_UPDATE_INTERVAL_MS);
    }
    if (this.platform.globalShortcut.supported) await this.registerShortcut(globalShortcut);
    this.offTrayAction?.();
    this.offTrayAction = this.platform.onTrayAction((action) => this.onTrayAction(action));
    for (const config of loadHosts(this.platform.storage)) {
      this.update({
        hosts: [...this.state.hosts, newHostView(config)],
      });
      const token = await this.platform.secrets.get(config.id);
      if (token) this.connect(config, token);
    }
    this.update({ hostsLoaded: true });
    // Last: the saved hosts must not wait for it.
    if (this.platform.terminal.supported) {
      this.update({ terminalEnv: await this.platform.terminal.probe() });
    }
  }

  async addHost(input: { name: string; url: string; token: string }): Promise<string> {
    const config: HostConfig = { id: crypto.randomUUID(), name: input.name, url: input.url };
    await this.platform.secrets.set(config.id, input.token);
    this.update({
      hosts: [...this.state.hosts, newHostView(config)],
    });
    this.persistHosts();
    this.connect(config, input.token);
    return config.id;
  }

  /** Tests the connection (`hello` + `host.info`) and saves the host only if it answers. */
  async testAndAddHost(input: {
    name: string;
    url: string;
    token: string;
  }): Promise<{ ok: true; hostId: string } | { ok: false; error: string }> {
    const probe = await probeHost(input.url, input.token, this.i18n.t);
    if (!probe.ok) return probe;
    return { ok: true, hostId: await this.addHost(input) };
  }

  async removeHost(hostId: string): Promise<void> {
    this.connections.get(hostId)?.dispose();
    this.connections.delete(hostId);
    await this.platform.secrets.delete(hostId);
    const sessions = Object.fromEntries(
      Object.entries(this.state.sessions).filter(([key]) => !key.startsWith(`${hostId}/`)),
    );
    const cards = Object.fromEntries(
      Object.entries(this.state.cards).filter(([key]) => !key.startsWith(`${hostId}/`)),
    );
    this.update({
      hosts: this.state.hosts.filter((h) => h.id !== hostId),
      sessions,
      cards,
      selected: this.state.selected?.hostId === hostId ? null : this.state.selected,
    });
    this.persistHosts();
  }

  renameHost(hostId: string, name: string): void {
    this.updateHost(hostId, (h) => ({ ...h, name }));
    this.persistHosts();
  }

  /** Drops the connection and opens a new one right away. */
  async reconnectHost(hostId: string): Promise<void> {
    const host = this.state.hosts.find((h) => h.id === hostId);
    const token = await this.platform.secrets.get(hostId);
    this.connections.get(hostId)?.dispose();
    if (host && token) this.connect(host, token);
  }

  /** "Abrir" on a request outside the window (tray, notification): the app shows it. */
  onOpenRequest(listener: (item: PendingItem) => void): () => void {
    this.openRequestListeners.add(listener);
    return () => this.openRequestListeners.delete(listener);
  }

  /**
   * A `flightdeck://request` link (a notification click): brings the window up on the request.
   * False for any other link, which the caller handles (pairing).
   */
  openRequestLink(url: string): boolean {
    const link = parseRequestLink(url);
    if (!link) return false;
    const item = needsYou(this.state).find(
      (i) => i.hostId === link.hostId && i.requestId === link.requestId,
    );
    // Already answered: the window still comes up.
    if (item) this.openRequest(item);
    else void this.platform.showMainWindow();
    return true;
  }

  private openRequest(item: PendingItem): void {
    void this.platform.showMainWindow();
    for (const listener of this.openRequestListeners) listener(item);
  }

  /** A click in the tray submenu: approve and deny answer without the window. */
  private onTrayAction({ key, action }: TrayAction): void {
    if (key === "more") {
      void this.platform.showMainWindow();
      return;
    }
    const item = needsYou(this.state).find((i) => `${i.hostId}/${i.requestId}` === key);
    if (!item) return;
    // The tray never approves a high-risk request: that takes holding the button in the app.
    if (action === "open" || (action === "approve" && item.risk === "high")) this.openRequest(item);
    else void this.respondTo(item.hostId, item.requestId, action === "approve" ? "allow" : "deny");
  }

  /** Opens a web page (an issue, a PR) in the user's browser; anything but http(s) is refused. */
  openLink(url: string): void {
    if (/^https?:\/\//i.test(url)) void this.platform.openExternal(url);
  }

  /** `flightdeck://` links opened from outside the app (OS deep link or second instance). */
  onDeepLink(handler: (url: string) => void): () => void {
    return this.platform.onDeepLink(handler);
  }

  /** Selects a session: only the open one keeps a subscription to its full event stream. */
  select(hostId: string, sessionId: string | null): void {
    const previous = this.state.selected;
    if (previous?.sessionId && previous.sessionId !== sessionId) {
      this.connections.get(previous.hostId)?.unsubscribe(previous.sessionId);
    }
    if (sessionId) this.connections.get(hostId)?.subscribe(sessionId);
    this.update({ selected: { hostId, sessionId } });
  }

  async setCloseToTray(enabled: boolean): Promise<void> {
    this.platform.storage.setItem(CLOSE_TO_TRAY_KEY, String(enabled));
    await this.platform.setCloseToTray(enabled);
    this.update({ settings: { ...this.state.settings, closeToTray: enabled } });
  }

  /** Validates, swaps the registration and saves the new shortcut only if the OS took it. */
  async setGlobalShortcut(text: string): Promise<void> {
    const check = validateShortcut(text, this.i18n.t);
    if (!check.ok) {
      this.updateSettings({ shortcutError: check.error });
      return;
    }
    if (this.shortcut) await this.platform.globalShortcut.unregister(this.shortcut);
    this.shortcut = null;
    if (await this.registerShortcut(check.value)) {
      this.platform.storage.setItem(SHORTCUT_KEY, check.value);
    }
  }

  private async registerShortcut(accelerator: string): Promise<boolean> {
    try {
      await this.platform.globalShortcut.register(accelerator, () => {
        void this.platform.showMainWindow();
        this.openSearch();
      });
      this.shortcut = accelerator;
      this.updateSettings({
        globalShortcut: accelerator,
        shortcutProblem: null,
        shortcutError: null,
      });
      return true;
    } catch {
      this.updateSettings({
        shortcutProblem: this.i18n.t("messages.shortcutTaken", { accelerator }),
        shortcutError: null,
      });
      return false;
    }
  }

  private updateSettings(patch: Partial<Settings>): void {
    this.update({ settings: { ...this.state.settings, ...patch } });
  }

  async setAutostart(enabled: boolean): Promise<void> {
    await this.platform.autostart.setEnabled(enabled);
    this.update({ settings: { ...this.state.settings, autostart: enabled } });
  }

  /** A host's projects into the state (quiet: a host without a board, or offline, lists none). */
  async loadProjects(hostId: string): Promise<Project[] | null> {
    const conn = this.connections.get(hostId);
    const list = conn ? await quiet(conn.request("project.list", {})) : null;
    if (!list) return null;
    this.update({ projects: { ...this.state.projects, [hostId]: list.projects } });
    return list.projects;
  }

  /**
   * What the palette lists besides live state: the Sessões lists, each host's projects and their
   * cards. Quiet: a host without a board (or offline) just lists less.
   */
  async loadPalette(): Promise<void> {
    const boards = this.state.hosts
      .filter((host) => host.status === "online")
      .map(async (host) => {
        const conn = this.connections.get(host.id) as HostConnection;
        const projects = await this.loadProjects(host.id);
        for (const project of projects ?? []) {
          const board = await quiet(conn.request("board.get", { projectId: project.id }));
          for (const card of cardsIn(board)) this.onCard(host.id, card);
        }
      });
    const targets = this.state.hosts
      .filter(
        (host) => host.status === "online" && hasFeature(host.hostInfo?.features, "ssh", false),
      )
      .map(async (host) => {
        const listed = await quiet(this.dispatch(host.id, "ssh.list", {}));
        if (listed) this.update({ ssh: { ...this.state.ssh, [host.id]: listed.targets } });
      });
    await Promise.all([this.refreshHub(), ...boards, ...targets]);
  }

  openSearch(): void {
    this.update({ searchOpen: true });
  }

  /** Closes a tab; a terminal's waits in `closingTerminal` for detach or end. */
  closeTab(area: Tabs, tabId: string): void {
    const tab = area.tabs.find((candidate) => candidate.id === tabId);
    if (tab?.router.current.name === "terminal") {
      this.update({ closingTerminal: { areaId: area.id, tabId } });
    } else area.close(tabId);
  }

  /** Ends the pending close of a terminal tab: `kill` ends the process, false detaches, null keeps it. */
  async finishCloseTerminal(kill: boolean | null): Promise<void> {
    const pending = this.state.closingTerminal;
    this.update({ closingTerminal: null });
    if (!pending || kill === null) return;
    const area = this.workspace.areas.find((candidate) => candidate.id === pending.areaId);
    const route = area?.tabs.find((tab) => tab.id === pending.tabId)?.router.current;
    if (!area || route?.name !== "terminal") return;
    await this.hostCommand(route.host, "terminal.close", { terminalId: route.terminalId, kill });
    area.close(pending.tabId);
  }

  closeSearch(): void {
    this.update({ searchOpen: false });
  }

  /**
   * Asks every online host at once and merges the hits by date as they arrive. Offline hosts are
   * reported right away; a host that does not answer within `searchTimeoutMs` is reported too.
   */
  async searchHistory(query: string): Promise<void> {
    if (!query.trim()) return;
    const token = ++this.searchSeq;
    const online = this.state.hosts.filter((h) => h.status === "online");
    // An incompatible host is out of every list, so it is not reported as silent either.
    const offline = this.state.hosts
      .filter((h) => h.status !== "online" && h.status !== "incompatible")
      .map((h) => h.id);
    this.update({ search: { query, hits: [], waiting: online.map((h) => h.id), silent: offline } });
    const timeoutMs = this.options.searchTimeoutMs ?? 5000;
    await Promise.all(
      online.map(async (host) => {
        const request = this.connections.get(host.id)?.request("history.search", { query });
        const result = await withTimeout(request, timeoutMs).catch(() => null);
        // A newer search replaced this one.
        if (token !== this.searchSeq) return;
        const search = this.state.search as SearchState;
        const waiting = search.waiting.filter((id) => id !== host.id);
        if (!result) {
          this.update({ search: { ...search, waiting, silent: [...search.silent, host.id] } });
          return;
        }
        const hits = [
          ...search.hits,
          ...result.hits.map((hit) => ({ ...hit, hostId: host.id, hostName: host.name })),
        ].sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? ""));
        this.update({ search: { ...search, waiting, hits } });
      }),
    );
  }

  /** A host's indexed sessions; errors go to the banner and give `null`. */
  async historyList(hostId: string, filter: HistoryFilter): Promise<HistoryListResult | null> {
    try {
      const conn = this.connections.get(hostId);
      if (!conn) throw new RequestError("offline", "host desconhecido");
      return await conn.request("history.list", { ...filter, limit: HISTORY_LIST_LIMIT });
    } catch (error) {
      this.fail(error);
      return null;
    }
  }

  /** One page of a host's transcript; errors go to the banner and give `null`. */
  async historyGet(
    hostId: string,
    claudeSessionId: string,
    cursor?: string,
  ): Promise<HistoryGetResult | null> {
    try {
      const conn = this.connections.get(hostId);
      if (!conn) throw new RequestError("offline", "host desconhecido");
      return await conn.request("history.get", {
        claudeSessionId,
        limit: HISTORY_PAGE,
        ...(cursor ? { cursor } : {}),
      });
    } catch (error) {
      this.fail(error);
      return null;
    }
  }

  /**
   * Continues an indexed transcript as a managed session and opens it. `force` is only sent after
   * the user confirmed a possibly-in-use session.
   */
  async resumeHistory(
    hostId: string,
    claudeSessionId: string,
    force: boolean,
  ): Promise<string | null> {
    try {
      const conn = this.connections.get(hostId);
      if (!conn) throw new RequestError("offline", "host desconhecido");
      const { sessionId } = await conn.request("history.resume", {
        claudeSessionId,
        ...(force ? { force: true } : {}),
      });
      this.select(hostId, sessionId);
      return sessionId;
    } catch (error) {
      this.fail(error);
      return null;
    }
  }

  /**
   * Sends a project, board or card command to a host. Cards in the answer go to `cards`; errors
   * go to the banner and give `null`.
   */
  async hostCommand<T extends HostCommandType>(
    hostId: string,
    type: T,
    payload: CommandPayload<T>,
  ): Promise<CommandResults[T] | null> {
    try {
      return await this.dispatch(hostId, type, payload);
    } catch (error) {
      this.fail(error);
      return null;
    }
  }

  /**
   * Like `hostCommand`, but a refusal comes back with its code and message instead of going to
   * the banner: for screens that explain it themselves (a file that changed, a merge conflict).
   */
  async hostRequest<T extends HostCommandType>(
    hostId: string,
    type: T,
    payload: CommandPayload<T>,
  ): Promise<HostResult<CommandResults[T]>> {
    try {
      return { ok: true, data: await this.dispatch(hostId, type, payload) };
    } catch (error) {
      // A connection only ever rejects with a RequestError (even a host it does not know).
      const { code, message } = error as RequestError;
      return { ok: false, code, message };
    }
  }

  private async dispatch<T extends HostCommandType>(
    hostId: string,
    type: T,
    payload: CommandPayload<T>,
  ): Promise<CommandResults[T]> {
    const conn = this.connections.get(hostId);
    if (!conn) throw new RequestError("offline", "host desconhecido");
    const result = await conn.request(type, payload);
    for (const card of cardsIn(result)) this.onCard(hostId, card);
    if (isRun(result)) this.onRun(hostId, result);
    return result;
  }

  /**
   * Loads what the Sessões screen lists from every online host. Quiet: a host without history or
   * hub (older daemon) just contributes less.
   */
  async refreshHub(): Promise<void> {
    await Promise.all(
      this.state.hosts
        .filter((host) => host.status === "online")
        .map(async (host) => {
          const conn = this.connections.get(host.id) as HostConnection;
          const [managed, history, external] = await Promise.all([
            quiet(conn.request("session.list", {})),
            quiet(conn.request("history.list", { limit: HISTORY_LIST_LIMIT })),
            quiet(conn.request("external.list", {})),
          ]);
          const meta = { ...this.state.meta };
          const externals = { ...this.state.externals };
          for (const s of [...(managed?.sessions ?? []), ...(history?.sessions ?? [])]) {
            if (s.claudeSessionId && s.meta) meta[sessionKey(host.id, s.claudeSessionId)] = s.meta;
          }
          for (const s of external?.sessions ?? []) {
            externals[sessionKey(host.id, s.claudeSessionId)] = s;
            if (s.meta) meta[sessionKey(host.id, s.claudeSessionId)] = s.meta;
          }
          const hub = {
            ...this.state.hub,
            [host.id]: { managed: managed?.sessions ?? [], history: history?.sessions ?? [] },
          };
          this.update({ hub, meta, externals });
        }),
    );
  }

  /** Renames, pins or archives a session (managed or external) of a host. */
  async setMeta(
    hostId: string,
    claudeSessionId: string,
    patch: Partial<SessionMeta>,
  ): Promise<void> {
    const result = await this.hostCommand(hostId, "session.meta.set", {
      claudeSessionId,
      ...patch,
    });
    if (!result) return;
    const { claudeSessionId: _id, ...meta } = result;
    this.update({ meta: { ...this.state.meta, [sessionKey(hostId, claudeSessionId)]: meta } });
  }

  /**
   * Calls `listener` with the diff of a review target each time it changes on the host's disk
   * (phase 11); the host keeps watching while someone listens. Returns the function that stops.
   */
  watchChanges(
    hostId: string,
    target: string,
    listener: (update: ChangesUpdated) => void,
  ): () => void {
    const key = `${hostId}|${target}`;
    const listeners = this.changeListeners.get(key) ?? new Set();
    this.changeListeners.set(key, listeners);
    listeners.add(listener);
    this.connections.get(hostId)?.watchChanges(target);
    return () => {
      listeners.delete(listener);
      if (listeners.size > 0) return;
      this.changeListeners.delete(key);
      this.connections.get(hostId)?.unwatchChanges(target);
    };
  }

  /** The commands of a host's terminals, as `TerminalSession` drives them (phase 14). */
  terminalHost(hostId: string): TerminalCommands {
    const request = <T extends Extract<CommandType, `terminal.${string}`>>(
      type: T,
      payload: CommandPayload<T>,
    ): Promise<CommandResults[T]> => this.dispatch(hostId, type, payload);
    return {
      open: async (cwd, cols, rows) => request("terminal.open", { cwd, cols, rows }),
      attach: (terminalId) => request("terminal.attach", { terminalId }),
      write: (terminalId, data) => request("terminal.write", { terminalId, data }),
      resize: (terminalId, cols, rows) => request("terminal.resize", { terminalId, cols, rows }),
      close: (terminalId, kill) => request("terminal.close", { terminalId, kill }),
      list: async () => (await request("terminal.list", {})).terminals,
    };
  }

  /** Opens a terminal on the host (in `cwd`, its first allowed folder by default) in a new tab. */
  async openTerminal(hostId: string, cwd?: string): Promise<string | null> {
    const folder = cwd ?? this.state.hosts.find((h) => h.id === hostId)?.info?.allowedRoots[0];
    if (!folder) return null;
    const opened = await this.hostCommand(hostId, "terminal.open", {
      cwd: folder,
      cols: 80,
      rows: 24,
    });
    if (!opened) return null;
    this.tabs.open({ name: "terminal", host: hostId, terminalId: opened.terminalId });
    return opened.terminalId;
  }

  /** "Claude aqui": `flightdeckd claude` (resuming `claudeSessionId` when given) in a terminal tab. */
  async openClaudeHere(hostId: string, target: TerminalTarget): Promise<string | null> {
    const opened = await this.hostCommand(hostId, "terminal.open", {
      cwd: target.cwd,
      cols: 80,
      rows: 24,
      claude: target.claudeSessionId ? { resume: target.claudeSessionId } : {},
    });
    if (!opened) return null;
    this.tabs.open({ name: "terminal", host: hostId, terminalId: opened.terminalId });
    return opened.terminalId;
  }

  /** Whether the host opens terminals inside the app (phase 14) right now. */
  embeddedTerminal(hostId: string): boolean {
    const host = this.state.hosts.find((h) => h.id === hostId);
    return host?.status === "online" && hasFeature(host.hostInfo?.features, "terminal", false);
  }

  /** Asks the host for its `host.info` again (after a change of its settings). */
  async reloadHostInfo(hostId: string): Promise<void> {
    const conn = this.connections.get(hostId);
    if (conn) await this.loadHostInfo(hostId, conn);
  }

  /** Calls `listener` with the output, exit, resync and loss of the host of a terminal. */
  followTerminal(hostId: string, terminalId: string, listener: TerminalListener): () => void {
    const key = `${hostId}|${terminalId}`;
    const listeners = this.terminalListeners.get(key) ?? new Set();
    this.terminalListeners.set(key, listeners);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.terminalListeners.delete(key);
    };
  }

  /** Runs `fn` after `ms` (the store's timers, which tests drive); returns the function that cancels. */
  later(fn: () => void, ms: number): () => void {
    const timers = this.options.timers ?? REAL_TIMERS;
    const handle = timers.setTimeout(fn, ms);
    return () => timers.clearTimeout(handle);
  }

  /** Transcripts growing on any host (live reader); returns the function that stops it. */
  onHistoryChanged(listener: (hostId: string, change: HistoryChanged) => void): () => void {
    this.historyListeners.add(listener);
    return () => this.historyListeners.delete(listener);
  }

  /** How "Abrir no terminal" opens `target` on this host; `null` for an unknown host. */
  terminalLaunch(hostId: string, target: TerminalTarget): TerminalLaunch | null {
    const host = this.state.hosts.find((h) => h.id === hostId);
    return host ? terminalLaunch(host, target, this.state.terminalEnv) : null;
  }

  /** Opens a terminal on this machine, or copies the command for a host elsewhere. */
  async openInTerminal(hostId: string, target: TerminalTarget): Promise<void> {
    const launch = this.terminalLaunch(hostId, target);
    if (launch?.kind === "copy") await this.copyText(launch.text);
    if (launch?.kind !== "spawn") return;
    try {
      await this.platform.terminal.open(launch.program, launch.args);
    } catch (error) {
      this.fail(error, this.i18n.t("messages.terminalFailed", { error: describeError(error) }));
    }
  }

  /** Saves a file through the system dialog; errors go to the banner. */
  async saveFile(name: string, text: string): Promise<boolean> {
    try {
      return await this.platform.saveFile(name, text);
    } catch (error) {
      this.fail(error, (error as Error).message);
      return false;
    }
  }

  /** Copies a secret's value and clears the clipboard `clearMs` later (phase 16). */
  async copySecret(id: string, clearMs: number): Promise<boolean> {
    const value = await this.vault.value(id);
    if (value === null || !(await this.copyText(value))) return false;
    setTimeout(() => void this.platform.copyText("").catch(() => {}), clearMs);
    return true;
  }

  async copyText(text: string): Promise<boolean> {
    try {
      await this.platform.copyText(text);
      this.success(this.i18n.t("toast.copied"));
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    }
  }

  reportError(message: string): void {
    this.fail(new Error(message));
  }

  clearError(): void {
    this.update({ error: null });
  }

  /** A short success toast (copied, saved, started…), already translated. */
  success(text: string): void {
    this.update({
      notices: [...this.state.notices, { id: ++this.noticeSeq, kind: "success", code: "", text }],
    });
  }

  /** A toast closed (or shown, for successes): it leaves the list. */
  dismissNotice(id: number): void {
    this.update({ notices: this.state.notices.filter((n) => n.id !== id) });
  }

  /**
   * A host's error: a toast titled by its code, with the daemon's message as the detail. `text`
   * replaces the old one-line form kept in `error` (and the detail of a codeless one).
   */
  private fail(error: unknown, text?: string): void {
    const code = error instanceof RequestError ? error.code : "";
    const message = error instanceof Error ? error.message : String(error);
    const notice: Notice = { id: ++this.noticeSeq, kind: "error", code, text: text ?? message };
    this.update({
      error: text ?? describeError(error),
      notices: [...this.state.notices, notice],
    });
  }

  async createSession(
    hostId: string,
    payload: CommandPayload<"session.create">,
  ): Promise<string | null> {
    const conn = this.connections.get(hostId);
    if (!conn) {
      this.fail(new RequestError("offline", "host desconhecido ou sem token"));
      return null;
    }
    try {
      const { sessionId } = await conn.request("session.create", payload);
      this.select(hostId, sessionId);
      // A new session opens, wherever it was created from (phase 10).
      this.closeSearch();
      this.router.push({ name: "session", host: hostId, id: sessionId });
      return sessionId;
    } catch (error) {
      this.fail(error);
      return null;
    }
  }

  send(text: string): Promise<void> {
    return this.onSelected((conn, sessionId) => conn.request("session.send", { sessionId, text }));
  }

  interrupt(): Promise<void> {
    return this.onSelected((conn, sessionId) => conn.request("session.interrupt", { sessionId }));
  }

  close(): Promise<void> {
    return this.onSelected((conn, sessionId) => conn.request("session.close", { sessionId }));
  }

  resume(): Promise<void> {
    return this.onSelected((conn, sessionId) => conn.request("session.resume", { sessionId }));
  }

  /** Answers a request from the "Precisa de você" queue, on whichever host it lives. */
  async respondTo(
    hostId: string,
    requestId: string,
    decision: "allow" | "deny",
    updatedPermissions?: PermissionUpdate[],
    /** Why it was denied (phase 10: the card's reason). */
    message?: string,
  ): Promise<void> {
    const question = this.vaultQuestions.get(requestId);
    if (question) {
      question(decision === "allow");
      return;
    }
    try {
      await this.connections.get(hostId)?.request("permission.respond", {
        requestId,
        decision,
        ...(updatedPermissions ? { updatedPermissions } : {}),
        ...(message ? { message } : {}),
      });
    } catch (error) {
      this.fail(error);
    }
  }

  /** Answers an open gate, from the card or from the "Precisa de você" queue. */
  async respondGate(
    hostId: string,
    gate: Omit<GateRef, "cardId">,
    decision: "approve" | "reject",
    note?: string,
  ): Promise<void> {
    const { runId, stepId, attempt } = gate;
    await this.hostCommand(hostId, "gate.respond", {
      runId,
      stepId,
      attempt,
      decision,
      ...(note?.trim() ? { note: note.trim() } : {}),
    });
  }

  respond(
    requestId: string,
    decision: "allow" | "deny",
    message?: string,
    updatedPermissions?: PermissionUpdate[],
  ): Promise<void> {
    return this.onSelected((conn) =>
      conn.request("permission.respond", {
        requestId,
        decision,
        ...(message ? { message } : {}),
        ...(updatedPermissions ? { updatedPermissions } : {}),
      }),
    );
  }

  dispose(): void {
    for (const conn of this.connections.values()) conn.dispose();
    this.connections.clear();
    this.offTrayAction?.();
    this.offTrayAction = null;
    if (this.updateTimer) clearInterval(this.updateTimer);
    this.updateTimer = null;
    this.theme.stop();
  }

  /** Asks the updater for a newer app version. */
  async checkAppUpdate(): Promise<void> {
    try {
      const offer = await this.platform.updater.check();
      this.update({ appUpdate: { offer, upToDate: offer === null, error: null } });
    } catch (error) {
      this.setAppUpdate({
        error: this.i18n.t("messages.updateCheckFailed", {
          error: (error as Error).message ?? String(error),
        }),
      });
    }
  }

  /** Installs the offered version; the app restarts. A failure installs nothing and says why. */
  async installAppUpdate(): Promise<void> {
    try {
      await this.platform.updater.install();
    } catch (error) {
      this.setAppUpdate({
        error: this.i18n.t("messages.updateInstallFailed", {
          error: (error as Error).message ?? String(error),
        }),
      });
    }
  }

  /** "Depois": the banner goes until the next check. */
  dismissAppUpdate(): void {
    this.setAppUpdate({ offer: null });
  }

  setNotifyUpdates(enabled: boolean): void {
    this.platform.storage.setItem(NOTIFY_UPDATES_KEY, String(enabled));
    this.update({ settings: { ...this.state.settings, notifyUpdates: enabled } });
  }

  private setAppUpdate(patch: Partial<AppUpdateState>): void {
    this.update({ appUpdate: { ...this.state.appUpdate, ...patch } });
  }

  // -- internals ------------------------------------------------------------

  private async onSelected(action: (conn: HostConnection, sessionId: string) => Promise<unknown>) {
    const selected = this.state.selected;
    const conn = selected && this.connections.get(selected.hostId);
    if (!conn || !selected?.sessionId) return;
    try {
      await action(conn, selected.sessionId);
    } catch (error) {
      this.fail(error);
    }
  }

  private connect(config: HostConfig, token: string): void {
    const conn = new HostConnection({
      url: config.url,
      token,
      clientName: "flightdeck-desktop",
      ...(this.options.baseDelayMs !== undefined ? { baseDelayMs: this.options.baseDelayMs } : {}),
      ...(this.options.maxDelayMs !== undefined ? { maxDelayMs: this.options.maxDelayMs } : {}),
      lastSeqFor: (sessionId) =>
        this.state.sessions[sessionKey(config.id, sessionId)]?.lastSeq ?? 0,
      onStatus: (status) => this.onStatus(config.id, conn, status),
      onSubscribed: (sessionId, result) => this.onSubscribed(config.id, sessionId, result),
      onPing: () => this.updateHost(config.id, (h) => ({ ...h, latencyMs: conn.latencyMs })),
      onEvent: (envelope) => this.onEvent(config.id, envelope),
      onCardUpdated: (card) => this.onCard(config.id, card),
      onExternal: (frame) => this.onExternal(config.id, frame),
      onVaultRequest: (request) => void this.onVaultRequest(config, request),
      onVaultUsed: (used) => {
        this.usage.recordUsed(config.id, used);
        this.keepUsage();
      },
      onRunUpdated: (run) => this.onRun(config.id, run),
      onQuotaUpdated: (state) => this.onQuota(config.id, state),
      onBudgetUpdated: (update) => this.onBudget(config.id, update),
      onTerminal: (frame) => {
        for (const listener of this.terminalListeners.get(`${config.id}|${frame.terminalId}`) ??
          []) {
          if (frame.type === "terminal.data") listener.data(frame.data);
          else if (frame.type === "terminal.exited") listener.exited(frame.exitCode);
          else listener.resync();
        }
      },
      onChangesUpdated: (update) => {
        for (const listener of this.changeListeners.get(`${config.id}|${update.target}`) ?? []) {
          listener(update);
        }
      },
      onHistoryChanged: (change) => {
        for (const listener of this.historyListeners) listener(config.id, change);
      },
      onAskpass: (request) => void this.onAskpass(config.id, request),
    });
    this.connections.set(config.id, conn);
    // A session selected before its host had a connection (a route opened at start-up).
    const selected = this.state.selected;
    if (selected?.hostId === config.id && selected.sessionId) conn.subscribe(selected.sessionId);
    conn.watch();
    conn.watchBoard();
    conn.watchHistory();
    conn.watchExternal();
    conn.watchRuns();
    conn.watchQuota();
    conn.watchBudgets();
    conn.watchVault();
    conn.connect();
  }

  private onStatus(hostId: string, conn: HostConnection, status: ConnectionStatus): void {
    this.updateHost(hostId, (h) => ({
      ...h,
      status,
      info: conn.info,
      incompatibility: conn.incompatibility,
    }));
    if (status === "online") {
      void this.loadHostInfo(hostId, conn);
      // Daemons before phase 7 have no quota: quietly nothing.
      void conn.request("quota.get", {}).then(
        (state) => this.onQuota(hostId, state),
        () => {},
      );
    }
    if (status !== "online") {
      for (const [key, listeners] of this.terminalListeners) {
        if (key.startsWith(`${hostId}|`)) for (const listener of listeners) listener.offline();
      }
    }
    if (status === "connecting") {
      // Partial text from before the drop will never be completed by a delta; drop it.
      const sessions = { ...this.state.sessions };
      for (const key of Object.keys(sessions)) {
        if (key.startsWith(`${hostId}/`))
          sessions[key] = endStreaming(sessions[key] as SessionState);
      }
      this.update({ sessions });
    }
  }

  /**
   * A session asked from the start that had events (`lastSeq` > 0) but replays none lost them
   * to the host's retention: the view says so instead of showing an empty conversation.
   */
  private onSubscribed(hostId: string, sessionId: string, result: SessionSubscribeResult): void {
    const key = sessionKey(hostId, sessionId);
    const current = this.state.sessions[key] ?? emptySession();
    if (result.replayed > 0 || result.session.lastSeq === 0 || current.lastSeq > 0) return;
    const pruned = {
      ...current,
      pruned: true,
      status: result.session.status,
      cwd: result.session.cwd,
    };
    this.update({ sessions: { ...this.state.sessions, [key]: pruned } });
  }

  /** Daemons without `host.info` (phase 1) answer with an error: the page says so. */
  private async loadHostInfo(hostId: string, conn: HostConnection): Promise<void> {
    const hostInfo = await conn.request("host.info", {}).catch(() => null);
    this.updateHost(hostId, (h) => {
      // Back on the version it was updating to: the update is over.
      const done = h.daemonUpdate && hostInfo?.daemonVersion === h.daemonUpdate.target;
      return { ...h, hostInfo, ...(done ? { daemonUpdate: null } : {}) };
    });
    // ssh asks for passwords through the daemon: this app is who answers.
    if (hasFeature(hostInfo?.features, "ssh", false)) {
      void conn.request("askpass.watch", {}).catch(() => null);
    }
    if (hasFeature(hostInfo?.features, "costs", false)) {
      const list = await conn.request("budget.list", {}).catch(() => null);
      if (list) this.update({ budgets: { ...this.state.budgets, [hostId]: list.budgets } });
    }
  }

  /**
   * Phase 9: asks the host's daemon to apply its update. The host shows "atualizando…" until it
   * reconnects on the new version; past the time limit, or on a refusal, it shows why.
   */
  async updateDaemon(hostId: string): Promise<void> {
    const host = this.state.hosts.find((h) => h.id === hostId);
    const target = host?.hostInfo?.update?.version;
    const conn = this.connections.get(hostId);
    if (!target || !conn) return;
    this.updateHost(hostId, (h) => ({ ...h, daemonUpdate: { target, failed: null } }));
    const fail = (failed: string) =>
      this.updateHost(hostId, (h) =>
        h.daemonUpdate?.target === target ? { ...h, daemonUpdate: { target, failed } } : h,
      );
    try {
      await conn.request("daemon.update.apply", { confirm: true });
    } catch (error) {
      fail((error as Error).message);
      return;
    }
    setTimeout(
      () => fail(this.i18n.t("messages.daemonUpdateLate", { version: target })),
      this.options.daemonUpdateTimeoutMs ?? 120_000,
    );
  }

  private onEvent(hostId: string, envelope: EventEnvelope): void {
    if (envelope.event.type === "session.summary") {
      this.onSummary(hostId, envelope.event);
      return;
    }
    const key = sessionKey(hostId, envelope.sessionId);
    const session = applyEnvelope(this.state.sessions[key] ?? emptySession(), envelope);
    this.update({ sessions: { ...this.state.sessions, [key]: session } });
  }

  /** Sidebar, queue, tray and notifications all come from `session.summary`. */
  private onSummary(hostId: string, summary: SessionEventOf<"session.summary">): void {
    const host = this.state.hosts.find((h) => h.id === hostId);
    if (!host) return;
    const next: SidebarSession = {
      id: summary.sessionId,
      name: summary.name,
      cwd: summary.cwd,
      status: summary.status,
      pendingPermissions: summary.pendingPermissions,
      updatedAt: summary.updatedAt,
    };
    const prev = host.sessions.find((s) => s.id === next.id);
    this.updateHost(hostId, (h) => ({
      ...h,
      sessions: prev ? h.sessions.map((s) => (s.id === next.id ? next : s)) : [...h.sessions, next],
    }));
    const replied =
      (prev?.status === "running" || prev?.status === "starting") && next.status === "idle";
    const key = sessionKey(hostId, next.id);
    if (replied && !this.shownSessions().has(key)) {
      this.update({ unread: { ...this.state.unread, [key]: true } });
    }
    const label = `${host.name} · ${next.name ?? basename(next.cwd)}`;
    const linkFor = (requestId: string) => requestLink(hostId, requestId);
    const focused = this.platform.isFocused();
    const t = this.i18n.t;
    for (const n of summaryNotifications(prev, next, label, focused, linkFor, t)) {
      void this.platform.notify(n);
    }
  }

  /** The sessions an area shows right now (the active tab of each area), by session key. */
  private shownSessions(): Set<string> {
    const shown = new Set<string>();
    for (const area of this.workspace.areas) {
      const route = area.router.current;
      if (route.name === "session") shown.add(sessionKey(route.host, route.id));
    }
    return shown;
  }

  /** A session on screen is read. */
  private clearShownUnread(): void {
    const shown = [...this.shownSessions()].filter((key) => this.state.unread[key]);
    if (shown.length === 0) return;
    const unread = { ...this.state.unread };
    for (const key of shown) delete unread[key];
    this.update({ unread });
  }

  /** External sessions follow `external.updated`; requests stay in the queue while open. */
  private onExternal(hostId: string, frame: ExternalUpdated | ExternalPermissionFrame): void {
    if (frame.type === "external.updated") {
      const key = sessionKey(hostId, frame.session.claudeSessionId);
      this.update({
        externals: { ...this.state.externals, [key]: frame.session },
        // The name and pin of a terminal session ride on its frames (phase 10).
        ...(frame.session.meta ? { meta: { ...this.state.meta, [key]: frame.session.meta } } : {}),
      });
      return;
    }
    const key = sessionKey(hostId, frame.requestId);
    const { [key]: _closed, ...open } = this.state.externalRequests;
    if (frame.state === "closed") {
      this.update({ externalRequests: open });
      return;
    }
    this.update({ externalRequests: { ...open, [key]: frame } });
    const host = this.state.hosts.find((h) => h.id === hostId);
    if (!this.platform.isFocused()) {
      void this.platform.notify({
        title: this.i18n.t("notify.externalTitle"),
        body: `${host?.name ?? hostId} · ${frame.toolName}`,
        link: requestLink(hostId, frame.requestId),
      });
    }
  }

  /** A discarded card leaves; any other replaces what the app had. */
  /** Crossing `pauseAt` notifies once per host, window and reset. */
  private onQuota(hostId: string, state: QuotaState): void {
    this.update({ quota: { ...this.state.quota, [hostId]: state } });
    const host = this.state.hosts.find((h) => h.id === hostId);
    for (const window of state.windows) {
      const key = `${hostId}/${window.window}/${window.resetsAt}`;
      if (!host || !isHot(window, state.pauseAt) || this.quotaNotified.has(key)) continue;
      this.quotaNotified.add(key);
      const { t } = this.i18n;
      const known = window.window === "five_hour" || window.window === "seven_day";
      const label = known ? t(`quota.windows.${window.window}` as Key) : window.window;
      const percent = Math.round((window.utilization ?? 0) * 100);
      void this.platform.notify({
        title: t("notify.quotaTitle"),
        body: t("notify.quotaBody", { host: host.name, window: label, percent }),
      });
    }
  }

  /** Creates a budget or changes the one with `input.id`; the list follows the answer. */
  async setBudget(hostId: string, input: BudgetInput): Promise<void> {
    const budget = await this.hostCommand(hostId, "budget.set", input);
    if (budget) this.keepBudget(hostId, budget, false);
  }

  /** Terminals opened from a ssh destino, by `hostId/terminalId`, for the badge of their screen. */
  readonly sshTerminals = new Map<string, { name: string; tags: string[] }>();

  /**
   * Keeps a copy of `target` (and of the destinos it jumps through) on `runner`, which builds the
   * ssh command from its own destinos: the copy it already has by name is updated, never doubled.
   * `null` when the host refuses.
   */
  async sshCopyTo(
    runner: string,
    target: SshTarget,
    all: SshTarget[],
    seen: Set<string> = new Set([target.id]),
  ): Promise<SshTarget | null> {
    const listed = await this.hostCommand(runner, "ssh.list", {});
    if (!listed) return null;
    let jump: string | null = null;
    const through = all.find((other) => other.id === target.jump);
    if (through && !seen.has(through.id)) {
      seen.add(through.id);
      const copy = await this.sshCopyTo(runner, through, all, seen);
      if (!copy) return null;
      jump = copy.id;
    }
    const existing = listed.targets.find((other) => other.name === target.name);
    return this.hostCommand(runner, "ssh.save", {
      ...(existing ? { id: existing.id } : {}),
      ...savePayload(target, target.name),
      viaHost: null,
      jump,
    });
  }

  /**
   * Answers a ssh prompt (`null` refuses, and ssh fails at once). The secret is sent and not
   * kept: the request leaves the list, and nothing else holds the answer.
   */
  async answerAskpass(hostId: string, requestId: string, secret: string | null): Promise<void> {
    this.update({
      askpass: this.state.askpass.filter(
        (item) => !(item.hostId === hostId && item.request.requestId === requestId),
      ),
    });
    await this.hostCommand(hostId, "askpass.answer", { requestId, secret });
  }

  /**
   * A secret of the vault for a use the app itself starts (ssh): the delivery rules are checked
   * for the host that will use it and the use is logged, as "you". The value is handed to the
   * caller and kept nowhere.
   */
  async vaultSecretFor(
    hostId: string,
    secretId: string,
    purpose: string,
  ): Promise<{ ok: true; value: string } | { ok: false; code: DeliveryRefusal }> {
    const host = this.state.hosts.find((h) => h.id === hostId);
    const check = await checkDelivery(secretId, {
      hostId,
      hostUrl: host?.url ?? "",
      vault: this.vault,
    });
    this.usage.recordOutcome({
      hostId,
      secretId,
      purpose,
      requester: "you",
      delivered: check.ok,
      reason: check.ok ? "" : check.reason,
    });
    this.keepUsage();
    return check.ok ? { ok: true, value: check.value } : { ok: false, code: check.code };
  }

  /**
   * ssh asks for a password: when its destino points at a secret of the vault that can be
   * delivered to the host, that answers; otherwise the person is asked.
   */
  private async onAskpass(hostId: string, request: AskpassRequest): Promise<void> {
    if (request.secretRef && this.vault.list().some((s) => s.id === request.secretRef)) {
      const got = await this.vaultSecretFor(hostId, request.secretRef, "ssh");
      if (got.ok) {
        await this.hostCommand(hostId, "askpass.answer", {
          requestId: request.requestId,
          secret: got.value,
        });
        return;
      }
    }
    this.update({ askpass: [...this.state.askpass, { hostId, request }] });
  }

  /**
   * Opens a terminal running ssh to `target`; the id of the terminal, or `null` when refused.
   * `privateKey` is the vault key of a `vault-key` destino, for this connection only.
   */
  async sshConnect(hostId: string, target: SshTarget, privateKey?: string): Promise<string | null> {
    const info = await this.hostCommand(hostId, "ssh.connect", {
      targetId: target.id,
      cols: 80,
      rows: 24,
      ...(privateKey ? { privateKey } : {}),
    });
    if (!info) return null;
    this.sshTerminals.set(`${hostId}/${info.terminalId}`, { name: target.name, tags: target.tags });
    return info.terminalId;
  }

  /** Phase 16: the vault, whose values live in the system keyring. */
  readonly vault: Vault;
  /** Phase 16: what was asked of the vault, kept in `storage`. */
  readonly usage: VaultUsageLog;

  private keepUsage(): void {
    this.update({ vaultUsage: this.usage.list() });
  }

  private readonly vaultListeners = new Set<(outcome: VaultOutcome) => void>();

  async addSecret(input: NewSecret): Promise<SecretMeta> {
    const meta = await this.vault.create(input);
    this.update({ secrets: this.vault.list() });
    return meta;
  }

  /** `ssh-keygen` makes a pair; the private key goes to the vault, the public one comes back. */
  async generateSshKey(input: NewKey): Promise<{ meta: SecretMeta; publicKey: string } | null> {
    try {
      const made = await this.vault.generateSshKey(input);
      this.update({ secrets: this.vault.list() });
      return made;
    } catch (error) {
      this.fail(error);
      return null;
    }
  }

  /** Stores a key file the person picks; null when the dialog is cancelled or it fails. */
  async importKeyFile(input: NewKey & { deleteOriginal?: boolean }): Promise<SecretMeta | null> {
    try {
      const meta = await this.vault.importKeyFile(input);
      this.update({ secrets: this.vault.list() });
      return meta;
    } catch (error) {
      this.fail(error);
      return null;
    }
  }

  /** Saves the vault as an encrypted `cofre.fdvault`; the reason when it is refused or cancelled. */
  async exportVault(
    passphrase: string,
    confirmation: string,
  ): Promise<{ ok: true } | { ok: false; code: BackupErrorCode | "cancelled" }> {
    try {
      const file = await exportVault(this.vault, passphrase, confirmation, {
        ...(this.options.vaultWorkFactor !== undefined && {
          workFactor: this.options.vaultWorkFactor,
        }),
      });
      const saved = await this.platform.saveFile("cofre.fdvault", toFdvault(file));
      return saved ? { ok: true } : { ok: false, code: "cancelled" };
    } catch (error) {
      if (error instanceof BackupError) return { ok: false, code: error.code };
      this.fail(error);
      return { ok: false, code: "cancelled" };
    }
  }

  /** Reads a `.fdvault` the person picks and compares it with the vault; changes nothing. */
  async previewVaultImport(
    passphrase: string,
  ): Promise<
    { ok: true; preview: ImportPreview } | { ok: false; code: BackupErrorCode | "cancelled" }
  > {
    try {
      const file = await this.platform.vault.pickFile();
      if (!file) return { ok: false, code: "cancelled" };
      const preview = await previewImport(this.vault, fromFdvault(file.text), passphrase);
      return { ok: true, preview };
    } catch (error) {
      if (error instanceof BackupError) return { ok: false, code: error.code };
      this.fail(error);
      return { ok: false, code: "cancelled" };
    }
  }

  async applyVaultImport(
    preview: ImportPreview,
    onConflict: ConflictChoice,
  ): Promise<ImportResult> {
    const result = await applyImport(this.vault, preview, onConflict);
    this.update({ secrets: this.vault.list() });
    return result;
  }

  /** Edits a secret's name, description, tags and allowed hosts; its value is not touched. */
  updateSecret(id: string, patch: SecretPatch): SecretMeta | null {
    const meta = this.vault.update(id, patch);
    this.update({ secrets: this.vault.list() });
    return meta;
  }

  async removeSecret(id: string): Promise<void> {
    await this.vault.remove(id);
    this.update({ secrets: this.vault.list() });
  }

  /** Calls `listener` with the result of each `vault.request` the daemon makes. */
  onVaultOutcome(listener: (outcome: VaultOutcome) => void): () => void {
    this.vaultListeners.add(listener);
    return () => {
      this.vaultListeners.delete(listener);
    };
  }

  /** Phase 17: the questions about the daemon's requests, answered from the queue, by request id. */
  private readonly vaultQuestions = new Map<string, (approved: boolean) => void>();

  private defaultVaultPolicy: VaultPolicy | null = null;

  /** Puts a request of the daemon for a secret in the queue and waits for the user's answer. */
  private askVault({ request, hostId, secret }: VaultRequestContext): Promise<boolean> {
    const { t } = this.i18n;
    const free = request.command !== undefined;
    const host = this.state.hosts.find((h) => h.id === hostId);
    const requester = t(`actionsUi.requester.${request.requester}` as Key);
    const input: Record<string, string> = {
      [t("vaultApproval.requester")]: requester,
      ...(free
        ? {
            [t("vaultApproval.command")]: request.command ?? "",
            [t("vaultApproval.secrets")]: (
              request.secrets ?? [secret?.name ?? request.secretId]
            ).join(", "),
            ...(request.host ? { [t("vaultApproval.host")]: request.host } : {}),
          }
        : {
            [t("vaultApproval.action")]: request.action ?? "",
            [t("vaultApproval.secret")]: secret?.name ?? request.secretId,
            ...Object.fromEntries(
              Object.entries(request.params ?? {}).map(([k, v]) => [
                `${t("vaultApproval.param")} ${k}`,
                v,
              ]),
            ),
          }),
    };
    const item: PendingItem = {
      hostId,
      hostName: host?.name ?? hostId,
      sessionId: "",
      sessionName: t("vaultApproval.session", { requester }),
      requestId: request.requestId,
      toolName: free ? "run_with_secret" : (request.action ?? ""),
      createdAt: new Date((this.options.now ?? Date.now)()).toISOString(),
      input,
      ...(free ? { risk: "high" as const, riskReason: t("vaultApproval.freeReason") } : {}),
      vault: true,
    };
    void this.platform.notify({
      title: t("vaultApproval.notifyTitle"),
      body: t("vaultApproval.notifyBody", {
        requester,
        what: free ? "run_with_secret" : item.toolName,
        host: item.hostName,
      }),
    });
    return new Promise((resolve) => {
      this.vaultQuestions.set(request.requestId, (approved) => {
        this.vaultQuestions.delete(request.requestId);
        this.update({
          vaultApprovals: this.state.vaultApprovals.filter(
            (i) => i.requestId !== request.requestId,
          ),
        });
        resolve(approved);
      });
      this.update({ vaultApprovals: [...this.state.vaultApprovals, item] });
    });
  }

  /** A `vault.request` of the daemon: the policy decides, and nothing is delivered unless it says so. */
  private async onVaultRequest(config: HostConfig, request: VaultRequestFrame): Promise<void> {
    const outcome = await answerVaultRequest(request, {
      hostId: config.id,
      hostUrl: config.url,
      vault: this.vault,
      policy:
        this.options.vaultPolicy ??
        (this.defaultVaultPolicy ??= actionPolicy({
          ask: (context) => this.askVault(context),
          now: this.options.now ?? Date.now,
        })),
      deliver: (payload) => this.dispatch(config.id, "vault.deliver", payload),
      now: this.options.now ?? Date.now,
    });
    this.usage.recordOutcome(outcome);
    this.keepUsage();
    // A run that waits for the secret fails at once, instead of at the daemon's deadline.
    if (!outcome.delivered) {
      void this.dispatch(config.id, "vault.deny", { requestId: request.requestId }).catch(() => {});
    }
    for (const listener of this.vaultListeners) listener(outcome);
  }

  async removeBudget(hostId: string, budget: Budget): Promise<void> {
    const removed = await this.hostCommand(hostId, "budget.remove", { id: budget.id });
    if (removed !== null) this.keepBudget(hostId, budget, true);
  }

  /** A crossed threshold notifies (the daemon sends each one once per period). */
  private onBudget(hostId: string, update: BudgetUpdated): void {
    this.keepBudget(hostId, update.budget, update.removed);
    const host = this.state.hosts.find((h) => h.id === hostId);
    if (update.threshold === null || !host) return;
    void this.platform.notify({
      title: this.i18n.t("messages.budgetTitle"),
      body: this.i18n.t("messages.budgetBody", {
        host: host.name,
        label: budgetLabel(update.budget, this.i18n.t),
        percent: Math.round(update.threshold * 100),
        limit: usd(update.budget.limitUsd),
      }),
    });
  }

  private keepBudget(hostId: string, budget: Budget, removed: boolean): void {
    const others = (this.state.budgets[hostId] ?? []).filter((b) => b.id !== budget.id);
    const list = removed
      ? others
      : [...others, budget].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    this.update({ budgets: { ...this.state.budgets, [hostId]: list } });
  }

  private onRun(hostId: string, run: WorkflowRun): void {
    this.update({ runs: { ...this.state.runs, [sessionKey(hostId, run.id)]: run } });
  }

  private onCard(hostId: string, card: Card): void {
    const { [sessionKey(hostId, card.id)]: _previous, ...others } = this.state.cards;
    const cards = card.discarded ? others : { ...others, [sessionKey(hostId, card.id)]: card };
    this.update({ cards });
  }

  private updateHost(hostId: string, fn: (host: HostView) => HostView): void {
    this.update({ hosts: this.state.hosts.map((h) => (h.id === hostId ? fn(h) : h)) });
  }

  private persistHosts(): void {
    saveHosts(
      this.platform.storage,
      this.state.hosts.map(({ id, name, url }) => ({ id, name, url })),
    );
  }

  private update(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    if (patch.hosts) this.syncTray();
    if (patch.hosts || patch.externalRequests || patch.externals || patch.runs || patch.cards) {
      this.scheduleTrayMenu();
    }
    for (const listener of this.listeners) listener();
  }

  /**
   * Rebuilds the tray submenu once the list stops changing for `TRAY_MENU_DELAY_MS`: each change
   * restarts the wait, and a list equal to the one sent cancels it.
   */
  private scheduleTrayMenu(): void {
    const timers = this.options.timers ?? REAL_TIMERS;
    if (this.trayMenuTimer !== null) timers.clearTimeout(this.trayMenuTimer);
    this.trayMenuTimer = null;
    if (JSON.stringify(trayMenu(needsYou(this.state), this.i18n.t)) === this.trayMenuSent) return;
    this.trayMenuTimer = timers.setTimeout(() => {
      this.trayMenuTimer = null;
      const menu = trayMenu(needsYou(this.state), this.i18n.t);
      this.trayMenuSent = JSON.stringify(menu);
      void this.platform.setTrayMenu(menu);
    }, TRAY_MENU_DELAY_MS);
  }

  /**
   * A new language: the tray's texts change at once (no debounce, the list did not change) and
   * every screen renders again.
   */
  private onLanguage(): void {
    this.syncTray();
    const menu = trayMenu(needsYou(this.state), this.i18n.t);
    this.trayMenuSent = JSON.stringify(menu);
    void this.platform.setTrayMenu(menu);
    for (const listener of this.listeners) listener();
  }

  /** Pushes the fleet-wide badge to the tray whenever it changes. */
  private syncTray(): void {
    // The requests the daemon approved by itself that the app has seen in its sessions.
    let autoApproved = 0;
    for (const session of Object.values(this.state.sessions)) {
      for (const item of session.items) {
        if (item.kind === "permission" && item.resolution?.auto) autoApproved++;
      }
    }
    const status = trayStatus(this.state.hosts, this.i18n.t, autoApproved);
    if (this.tray?.label === status.label && this.tray.tooltip === status.tooltip) return;
    this.tray = status;
    void this.platform.setTrayStatus(status);
  }
}
