import type {
  CommandPayload,
  EventEnvelope,
  HelloResult,
  HistoryGetResult,
  HistorySearchHit,
  HostInfoResult,
  PendingPermission,
  SessionEventOf,
  SessionStatus,
} from "@flightdeck/protocol";
import type { Platform, TrayStatus } from "../platform/types.ts";
import { type ConnectionStatus, HostConnection, RequestError } from "./host-connection.ts";
import { type HostConfig, loadHosts, saveHosts } from "./hosts.ts";
import { summaryNotifications } from "./notify.ts";
import { basename } from "./paths.ts";
import { probeHost } from "./probe-host.ts";
import { applyEnvelope, emptySession, endStreaming, type SessionState } from "./session-state.ts";
import { trayStatus } from "./tray.ts";

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
}

export interface AppStoreOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** How long the global search waits for each host. */
  searchTimeoutMs?: number;
}

export interface PendingItem {
  hostId: string;
  hostName: string;
  sessionId: string;
  sessionName: string;
  requestId: string;
  toolName: string;
  createdAt: string;
}

/** Every open permission request of every host, oldest first. */
export function needsYou(state: AppState): PendingItem[] {
  return state.hosts
    .flatMap((host) =>
      host.sessions.flatMap((session) =>
        session.pendingPermissions.map((p) => ({
          hostId: host.id,
          hostName: host.name,
          sessionId: session.id,
          sessionName: session.name ?? basename(session.cwd),
          requestId: p.requestId,
          toolName: p.toolName,
          createdAt: p.createdAt,
        })),
      ),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Messages per `history.get` page in the transcript reader. */
export const HISTORY_PAGE = 50;

/** Preference stored in plain settings; anything but "false" means on. */
export const CLOSE_TO_TRAY_KEY = "flightdeck.closeToTray";

export const sessionKey = (hostId: string, sessionId: string) => `${hostId}/${sessionId}`;

const newHostView = (config: HostConfig): HostView => ({
  ...config,
  status: "offline",
  info: null,
  hostInfo: null,
  latencyMs: null,
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
      // Defaults: close to tray on, start with Windows off.
      settings: {
        closeToTray: true,
        autostart: false,
        autostartSupported: platform.autostart.supported,
      },
    };
  }

  getState = (): AppState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async init(): Promise<void> {
    // Reset synchronously first: nothing from a previous init may stay visible while awaiting.
    this.dispose();
    this.update({ hosts: [], sessions: {}, selected: null });
    const closeToTray = this.platform.storage.getItem(CLOSE_TO_TRAY_KEY) !== "false";
    await this.platform.setCloseToTray(closeToTray);
    const autostart =
      this.platform.autostart.supported && (await this.platform.autostart.isEnabled());
    this.update({ settings: { ...this.state.settings, closeToTray, autostart } });
    for (const config of loadHosts(this.platform.storage)) {
      this.update({
        hosts: [...this.state.hosts, newHostView(config)],
      });
      const token = await this.platform.secrets.get(config.id);
      if (token) this.connect(config, token);
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
    this.update({
      hosts: this.state.hosts.filter((h) => h.id !== hostId),
      sessions,
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

  async setAutostart(enabled: boolean): Promise<void> {
    await this.platform.autostart.setEnabled(enabled);
    this.update({ settings: { ...this.state.settings, autostart: enabled } });
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
    const offline = this.state.hosts.filter((h) => h.status !== "online").map((h) => h.id);
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
  async respondTo(hostId: string, requestId: string, decision: "allow" | "deny"): Promise<void> {
    try {
      await this.connections.get(hostId)?.request("permission.respond", { requestId, decision });
    } catch (error) {
      this.update({ error: describeError(error) });
    }
  }

  respond(requestId: string, decision: "allow" | "deny", message?: string): Promise<void> {
    return this.onSelected((conn) =>
      conn.request("permission.respond", { requestId, decision, ...(message ? { message } : {}) }),
    );
  }

  dispose(): void {
    for (const conn of this.connections.values()) conn.dispose();
    this.connections.clear();
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
      onSubscribed: () => {},
      onPing: () => this.updateHost(config.id, (h) => ({ ...h, latencyMs: conn.latencyMs })),
      onEvent: (envelope) => this.onEvent(config.id, envelope),
    });
    this.connections.set(config.id, conn);
    conn.watch();
    conn.connect();
  }

  private onStatus(hostId: string, conn: HostConnection, status: ConnectionStatus): void {
    this.updateHost(hostId, (h) => ({ ...h, status, info: conn.info }));
    if (status === "online") void this.loadHostInfo(hostId, conn);
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

  /** Daemons without `host.info` (phase 1) answer with an error: the page says so. */
  private async loadHostInfo(hostId: string, conn: HostConnection): Promise<void> {
    const hostInfo = await conn.request("host.info", {}).catch(() => null);
    this.updateHost(hostId, (h) => ({ ...h, hostInfo }));
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
    for (const n of summaryNotifications(prev, next, label, this.platform.isFocused())) {
      void this.platform.notify(n);
    }
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
    for (const listener of this.listeners) listener();
  }

  /** Pushes the fleet-wide badge to the tray whenever it changes. */
  private syncTray(): void {
    const status = trayStatus(this.state.hosts);
    if (this.tray?.count === status.count && this.tray.tooltip === status.tooltip) return;
    this.tray = status;
    void this.platform.setTrayStatus(status);
  }
}
