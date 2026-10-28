import type {
  CommandPayload,
  EventEnvelope,
  HelloResult,
  SessionSummary,
} from "@flightdeck/protocol";
import type { Platform } from "../platform/types.ts";
import { type ConnectionStatus, HostConnection, RequestError } from "./host-connection.ts";
import { type HostConfig, loadHosts, saveHosts } from "./hosts.ts";
import { notificationFor } from "./notify.ts";
import { basename } from "./paths.ts";
import { probeHost } from "./probe-host.ts";
import { applyEnvelope, emptySession, endStreaming, type SessionState } from "./session-state.ts";

export interface HostView extends HostConfig {
  status: ConnectionStatus;
  info: HelloResult | null;
  sessions: SessionSummary[];
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
}

export interface AppStoreOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export const sessionKey = (hostId: string, sessionId: string) => `${hostId}/${sessionId}`;

function describeError(error: unknown): string {
  return error instanceof RequestError ? `${error.code}: ${error.message}` : String(error);
}

/**
 * All app state in one framework-free store: hosts and their connections, session timelines and
 * the current selection. React reads it through `useSyncExternalStore`.
 */
export class AppStore {
  private state: AppState = { hosts: [], sessions: {}, selected: null, error: null };
  private readonly listeners = new Set<() => void>();
  private readonly connections = new Map<string, HostConnection>();
  /** Per session: seq up to which events are replay (no notifications for those). */
  private readonly liveFrom = new Map<string, number>();

  constructor(
    private readonly platform: Platform,
    private readonly options: AppStoreOptions = {},
  ) {}

  getState = (): AppState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async init(): Promise<void> {
    this.dispose();
    this.update({ hosts: [], sessions: {}, selected: null });
    for (const config of loadHosts(this.platform.storage)) {
      this.update({
        hosts: [...this.state.hosts, { ...config, status: "offline", info: null, sessions: [] }],
      });
      const token = await this.platform.secrets.get(config.id);
      if (token) this.connect(config, token);
    }
  }

  async addHost(input: { name: string; url: string; token: string }): Promise<string> {
    const config: HostConfig = { id: crypto.randomUUID(), name: input.name, url: input.url };
    await this.platform.secrets.set(config.id, input.token);
    this.update({
      hosts: [...this.state.hosts, { ...config, status: "offline", info: null, sessions: [] }],
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

  select(hostId: string, sessionId: string | null): void {
    this.update({ selected: { hostId, sessionId } });
  }

  reportError(message: string): void {
    this.update({ error: message });
  }

  /** `flightdeck://` links opened from outside the app (including the one it started with). */
  onDeepLink(handler: (url: string) => void): () => void {
    return this.platform.onDeepLink(handler);
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
      await this.refresh(hostId);
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
      onSubscribed: (sessionId, result) => {
        this.liveFrom.set(sessionKey(config.id, sessionId), result.session.lastSeq);
        this.updateSummary(config.id, result.session);
      },
      onEvent: (envelope) => this.onEvent(config.id, envelope),
    });
    this.connections.set(config.id, conn);
    conn.connect();
  }

  private onStatus(hostId: string, conn: HostConnection, status: ConnectionStatus): void {
    this.updateHost(hostId, (h) => ({ ...h, status, info: conn.info }));
    if (status === "connecting") {
      // Partial text from before the drop will never be completed by a delta; drop it.
      const sessions = { ...this.state.sessions };
      for (const key of Object.keys(sessions)) {
        if (key.startsWith(`${hostId}/`))
          sessions[key] = endStreaming(sessions[key] as SessionState);
      }
      this.update({ sessions });
    }
    if (status === "online") void this.refresh(hostId);
  }

  /** Reloads the session list of a host and subscribes to every session in it. */
  private async refresh(hostId: string): Promise<void> {
    const conn = this.connections.get(hostId);
    if (!conn) return;
    try {
      const { sessions } = await conn.request("session.list", {});
      this.updateHost(hostId, (h) => ({ ...h, sessions }));
      for (const session of sessions) conn.subscribe(session.id);
    } catch (error) {
      this.update({ error: describeError(error) });
    }
  }

  private onEvent(hostId: string, envelope: EventEnvelope): void {
    const key = sessionKey(hostId, envelope.sessionId);
    const before = this.state.sessions[key] ?? emptySession();
    const after = applyEnvelope(before, envelope);
    this.update({ sessions: { ...this.state.sessions, [key]: after } });

    const { event } = envelope;
    if (event.type === "session.status") {
      this.updateHost(hostId, (h) => ({
        ...h,
        sessions: h.sessions.map((s) =>
          s.id === envelope.sessionId ? { ...s, status: event.status } : s,
        ),
      }));
    }
    const liveFrom = this.liveFrom.get(key);
    if (liveFrom === undefined || envelope.seq <= liveFrom || after === before) return;
    const summary = this.state.hosts
      .find((h) => h.id === hostId)
      ?.sessions.find((s) => s.id === envelope.sessionId);
    const label = summary?.name ?? basename(summary?.cwd ?? after.cwd ?? envelope.sessionId);
    const notification = notificationFor(event, label, this.platform.isFocused());
    if (notification) void this.platform.notify(notification);
  }

  /** Subscriptions always follow a `session.list`, so the session is already in the sidebar. */
  private updateSummary(hostId: string, summary: SessionSummary): void {
    this.updateHost(hostId, (h) => ({
      ...h,
      sessions: h.sessions.map((s) => (s.id === summary.id ? summary : s)),
    }));
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
    for (const listener of this.listeners) listener();
  }
}
