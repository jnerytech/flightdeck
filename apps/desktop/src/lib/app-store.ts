import type {
  Budget,
  BudgetInput,
  BudgetUpdated,
  Card,
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
  SessionEventOf,
  SessionMeta,
  SessionStatus,
  SessionSubscribeResult,
  SessionSummary,
  WorkflowRun,
} from "@flightdeck/protocol";
import type { Platform, TrayAction, TrayStatus } from "../platform/types.ts";
import { budgetLabel } from "./budgets.ts";
import { localDay, usd } from "./costs.ts";
import { type ConnectionStatus, HostConnection, RequestError } from "./host-connection.ts";
import { type HostConfig, loadHosts, saveHosts } from "./hosts.ts";
import { summaryNotifications } from "./notify.ts";
import { basename } from "./paths.ts";
import { probeHost } from "./probe-host.ts";
import { isHot, WINDOW_LABELS } from "./quota.ts";
import { parseRequestLink, requestLink } from "./request-link.ts";
import { applyEnvelope, emptySession, endStreaming, type SessionState } from "./session-state.ts";
import { DEFAULT_SHORTCUT, SHORTCUT_KEY, validateShortcut } from "./shortcut.ts";
import {
  type TerminalEnv,
  type TerminalLaunch,
  type TerminalTarget,
  terminalLaunch,
} from "./terminal.ts";
import { TRAY_MENU_DELAY_MS, trayMenu, trayStatus } from "./tray.ts";
import { hasFeature } from "./version.ts";

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
  /** Workflow runs seen so far, by `sessionKey(hostId, runId)`; kept by `run.updated`. */
  runs: Record<string, WorkflowRun>;
  /** Managed and history lists of each host for the Sessões screen. */
  hub: Record<string, { managed: SessionSummary[]; history: HistorySessionSummary[] }>;
  /** This machine's terminals (phase 8), probed at init; `null` where none can be opened. */
  terminalEnv: TerminalEnv | null;
  /** Projects of each host, loaded for the Ctrl+K palette (phase 8). */
  projects: Record<string, Project[]>;
}

/** Commands sent through `hostCommand`: board (phase 4), hooks, external sessions and meta (phase 5). */
export type HostCommandType = Extract<
  CommandType,
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
>;

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
  /** Timers of the tray submenu's debounce (phase 8); the real ones when absent. */
  timers?: {
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  /** `YYYY-MM-DD` of an instant (cost periods); this machine's time zone when absent. */
  day?: (ms: number) => string;
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
  /** An open gate of a workflow run (`sessionId` is the card), answered with `gate.respond`. */
  gate?: GateRef;
}

export interface GateRef {
  runId: string;
  stepId: string;
  attempt: number;
  cardId: string;
}

/** Every open permission request of every host, oldest first. */
export function needsYou(state: AppState): PendingItem[] {
  return state.hosts
    .flatMap((host) => [
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
    ])
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Filters of the per-host history list. */
export type HistoryFilter = Omit<CommandPayload<"history.list">, "cursor" | "limit">;

/** Sessions shown by the per-host history list (the newest ones; filters narrow it down). */
export const HISTORY_LIST_LIMIT = 200;

/** Messages per `history.get` page in the transcript reader. */
export const HISTORY_PAGE = 50;

/** Preference stored in plain settings; anything but "false" means on. */
export const CLOSE_TO_TRAY_KEY = "flightdeck.closeToTray";

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
  private tray: TrayStatus | null = null;
  private searchSeq = 0;
  /** Quota windows already notified, by host, window and reset. */
  private readonly quotaNotified = new Set<string>();
  private readonly historyListeners = new Set<(hostId: string, change: HistoryChanged) => void>();
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
    this.state = {
      hosts: [],
      sessions: {},
      selected: null,
      error: null,
      search: null,
      searchOpen: false,
      cards: {},
      runs: {},
      quota: {},
      budgets: {},
      externals: {},
      externalRequests: {},
      meta: {},
      hub: {},
      terminalEnv: null,
      projects: {},
      // Defaults: close to tray on, start with Windows off.
      settings: {
        closeToTray: true,
        autostart: false,
        autostartSupported: platform.autostart.supported,
        globalShortcut: DEFAULT_SHORTCUT,
        globalShortcutSupported: platform.globalShortcut.supported,
        shortcutProblem: null,
        shortcutError: null,
      },
    };
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
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async init(): Promise<void> {
    // Reset synchronously first: nothing from a previous init may stay visible while awaiting.
    this.dispose();
    this.update({ hosts: [], sessions: {}, selected: null, cards: {}, runs: {}, quota: {} });
    const closeToTray = this.platform.storage.getItem(CLOSE_TO_TRAY_KEY) !== "false";
    await this.platform.setCloseToTray(closeToTray);
    const autostart =
      this.platform.autostart.supported && (await this.platform.autostart.isEnabled());
    const globalShortcut = this.platform.storage.getItem(SHORTCUT_KEY) ?? DEFAULT_SHORTCUT;
    this.update({ settings: { ...this.state.settings, closeToTray, autostart, globalShortcut } });
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
    const probe = await probeHost(input.url, input.token);
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
    if (action === "open") this.openRequest(item);
    else void this.respondTo(item.hostId, item.requestId, action === "approve" ? "allow" : "deny");
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
    const check = validateShortcut(text);
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
        shortcutProblem: `O atalho ${accelerator} não pôde ser registrado: outro programa já deve usá-lo. Escolha outro.`,
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

  /**
   * What the palette lists besides live state: the Sessões lists, each host's projects and their
   * cards. Quiet: a host without a board (or offline) just lists less.
   */
  async loadPalette(): Promise<void> {
    const boards = this.state.hosts
      .filter((host) => host.status === "online")
      .map(async (host) => {
        const conn = this.connections.get(host.id) as HostConnection;
        const list = await quiet(conn.request("project.list", {}));
        if (!list) return;
        this.update({ projects: { ...this.state.projects, [host.id]: list.projects } });
        for (const project of list.projects) {
          const board = await quiet(conn.request("board.get", { projectId: project.id }));
          for (const card of cardsIn(board)) this.onCard(host.id, card);
        }
      });
    await Promise.all([this.refreshHub(), ...boards]);
  }

  openSearch(): void {
    this.update({ searchOpen: true });
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
      this.update({ error: describeError(error) });
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
      this.update({ error: describeError(error) });
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
      this.update({ error: describeError(error) });
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
      const conn = this.connections.get(hostId);
      if (!conn) throw new RequestError("offline", "host desconhecido");
      const result = await conn.request(type, payload);
      for (const card of cardsIn(result)) this.onCard(hostId, card);
      if (isRun(result)) this.onRun(hostId, result);
      return result;
    } catch (error) {
      this.update({ error: describeError(error) });
      return null;
    }
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
      this.update({ error: `Terminal não abriu: ${describeError(error)}` });
    }
  }

  /** Saves a file through the system dialog; errors go to the banner. */
  async saveFile(name: string, text: string): Promise<boolean> {
    try {
      return await this.platform.saveFile(name, text);
    } catch (error) {
      this.update({ error: (error as Error).message });
      return false;
    }
  }

  async copyText(text: string): Promise<boolean> {
    try {
      await this.platform.copyText(text);
      return true;
    } catch (error) {
      this.update({ error: describeError(error) });
      return false;
    }
  }

  reportError(message: string): void {
    this.update({ error: message });
  }

  clearError(): void {
    this.update({ error: null });
  }

  async createSession(
    hostId: string,
    payload: CommandPayload<"session.create">,
  ): Promise<string | null> {
    const conn = this.connections.get(hostId);
    if (!conn) {
      this.update({ error: "host desconhecido ou sem token" });
      return null;
    }
    try {
      const { sessionId } = await conn.request("session.create", payload);
      this.select(hostId, sessionId);
      return sessionId;
    } catch (error) {
      this.update({ error: describeError(error) });
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
  ): Promise<void> {
    try {
      await this.connections.get(hostId)?.request("permission.respond", {
        requestId,
        decision,
        ...(updatedPermissions ? { updatedPermissions } : {}),
      });
    } catch (error) {
      this.update({ error: describeError(error) });
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
  }

  // -- internals ------------------------------------------------------------

  private async onSelected(action: (conn: HostConnection, sessionId: string) => Promise<unknown>) {
    const selected = this.state.selected;
    const conn = selected && this.connections.get(selected.hostId);
    if (!conn || !selected?.sessionId) return;
    try {
      await action(conn, selected.sessionId);
    } catch (error) {
      this.update({ error: describeError(error) });
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
      onRunUpdated: (run) => this.onRun(config.id, run),
      onQuotaUpdated: (state) => this.onQuota(config.id, state),
      onBudgetUpdated: (update) => this.onBudget(config.id, update),
      onHistoryChanged: (change) => {
        for (const listener of this.historyListeners) listener(config.id, change);
      },
    });
    this.connections.set(config.id, conn);
    conn.watch();
    conn.watchBoard();
    conn.watchHistory();
    conn.watchExternal();
    conn.watchRuns();
    conn.watchQuota();
    conn.watchBudgets();
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
    this.updateHost(hostId, (h) => ({ ...h, hostInfo }));
    if (hasFeature(hostInfo?.features, "costs", false)) {
      const list = await conn.request("budget.list", {}).catch(() => null);
      if (list) this.update({ budgets: { ...this.state.budgets, [hostId]: list.budgets } });
    }
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
    const label = `${host.name} · ${next.name ?? basename(next.cwd)}`;
    const linkFor = (requestId: string) => requestLink(hostId, requestId);
    for (const n of summaryNotifications(prev, next, label, this.platform.isFocused(), linkFor)) {
      void this.platform.notify(n);
    }
  }

  /** External sessions follow `external.updated`; requests stay in the queue while open. */
  private onExternal(hostId: string, frame: ExternalUpdated | ExternalPermissionFrame): void {
    if (frame.type === "external.updated") {
      const key = sessionKey(hostId, frame.session.claudeSessionId);
      this.update({ externals: { ...this.state.externals, [key]: frame.session } });
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
        title: "Precisa de você",
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
      const label = WINDOW_LABELS[window.window] ?? window.window;
      const percent = Math.round((window.utilization ?? 0) * 100);
      void this.platform.notify({
        title: "Cota do plano",
        body: `${host.name}: ${label} em ${percent}%`,
      });
    }
  }

  /** Creates a budget or changes the one with `input.id`; the list follows the answer. */
  async setBudget(hostId: string, input: BudgetInput): Promise<void> {
    const budget = await this.hostCommand(hostId, "budget.set", input);
    if (budget) this.keepBudget(hostId, budget, false);
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
      title: "Orçamento",
      body: `${host.name}: ${budgetLabel(update.budget)} em ${Math.round(update.threshold * 100)}% de ${usd(update.budget.limitUsd)}`,
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
    if (JSON.stringify(trayMenu(needsYou(this.state))) === this.trayMenuSent) return;
    this.trayMenuTimer = timers.setTimeout(() => {
      this.trayMenuTimer = null;
      const menu = trayMenu(needsYou(this.state));
      this.trayMenuSent = JSON.stringify(menu);
      void this.platform.setTrayMenu(menu);
    }, TRAY_MENU_DELAY_MS);
  }

  /** Pushes the fleet-wide badge to the tray whenever it changes. */
  private syncTray(): void {
    const status = trayStatus(this.state.hosts);
    if (this.tray?.count === status.count && this.tray.tooltip === status.tooltip) return;
    this.tray = status;
    void this.platform.setTrayStatus(status);
  }
}
