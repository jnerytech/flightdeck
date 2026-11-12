import type { ChangesUpdated } from "@flightdeck/protocol";
import { type ConnectionStatus, HostConnection, type HostConnectionOptions } from "./host-connection.ts";
import type { HostConfig } from "./hosts.ts";

/** Where the window's events (focus, the network) arrive: `window` in a browser or the webview, else the runtime's own global. */
const wakeTarget = (): Partial<Window> =>
  ("window" in globalThis ? globalThis.window : globalThis) as unknown as Partial<Window>;

/** The frame callbacks the rest of the app handles; the link keeps the status, the ping and the changes. */
export type HostFrames = Omit<
  HostConnectionOptions,
  | "url"
  | "token"
  | "clientName"
  | "hostId"
  | "baseDelayMs"
  | "wakeDebounceMs"
  | "maxDelayMs"
  | "staleMs"
  | "connectTimeoutMs"
  | "watchdog"
  | "lastSeqFor"
  | "onStatus"
  | "onPing"
  | "onChangesUpdated"
>;

/** What the link reads of the rest of the app. */
export interface HostLinkDeps {
  options(): { baseDelayMs?: number; wakeDebounceMs?: number; maxDelayMs?: number };
  /** The token is remembered for the scan of what the app shows. */
  rememberToken(token: string): void;
  lastSeqFor(hostId: string, sessionId: string): number;
  /** The selected session, subscribed on connect when it is on this host. */
  selected(): { hostId: string; sessionId: string | null } | null;
  /** The watched sessions, by `hostId/sessionId`, subscribed on connect. */
  watched(): Iterable<string>;
  onStatus(hostId: string, conn: HostConnection, status: ConnectionStatus): void;
  frames(config: HostConfig): HostFrames;
  /** Runs after every connection was woken (the window came back). */
  onWake(): void;
}

/**
 * The app's connections to its hosts (#1596, `docs/decisions/2026-11-12-app-store-hub-split.md`):
 * one `HostConnection` per host, built here, woken here, and closed here.
 */
export class HostLink {
  private readonly connections = new Map<string, HostConnection>();
  /** Who watches each review target's diff (phase 11), by `hostId|target`. */
  private readonly changeListeners = new Map<string, Set<(update: ChangesUpdated) => void>>();
  private readonly latencies = new Map<string, number | null>();
  private readonly latencyListeners = new Set<() => void>();
  private stopWake: (() => void) | null = null;

  constructor(private readonly deps: HostLinkDeps) {}

  connection(hostId: string): HostConnection | undefined {
    return this.connections.get(hostId);
  }

  /** A host's open connection; its callers have checked that it has one first. */
  open(hostId: string): HostConnection {
    const conn = this.connections.get(hostId);
    if (!conn) throw new Error(`no connection for ${hostId}`);
    return conn;
  }

  /** Closes a host's connection and keeps it in the map (a stopped host). */
  stop(hostId: string): void {
    this.connections.get(hostId)?.dispose();
  }

  /** Closes a host's connection and forgets it (a removed host). */
  remove(hostId: string): void {
    this.connections.get(hostId)?.dispose();
    this.connections.delete(hostId);
  }

  connect(config: HostConfig, token: string): void {
    this.deps.rememberToken(token);
    const options = this.deps.options();
    const conn = new HostConnection({
      url: config.url,
      token,
      clientName: "flightdeck-desktop",
      hostId: config.id,
      ...(options.baseDelayMs !== undefined
        ? { baseDelayMs: options.baseDelayMs }
        : {}),
      ...(options.wakeDebounceMs !== undefined
        ? { wakeDebounceMs: options.wakeDebounceMs }
        : {}),
      ...(options.maxDelayMs !== undefined
        ? { maxDelayMs: options.maxDelayMs }
        : {}),
      lastSeqFor: (sessionId) => this.deps.lastSeqFor(config.id, sessionId),
      onStatus: (status) => this.deps.onStatus(config.id, conn, status),
      onPing: () => this.setLatency(config.id, conn.latencyMs),
      ...this.deps.frames(config),
      onChangesUpdated: (update) => {
        for (const listener of this.changeListeners.get(`${config.id}|${update.target}`) ?? []) {
          listener(update);
        }
      },
    });
    this.connections.set(config.id, conn);
    // A session selected before its host had a connection (a route opened at start-up).
    const selected = this.deps.selected();
    if (selected?.hostId === config.id && selected.sessionId) conn.subscribe(selected.sessionId);
    for (const key of this.deps.watched()) {
      if (key.startsWith(`${config.id}/`)) conn.subscribe(key.slice(config.id.length + 1));
    }
    conn.watch();
    conn.watchBoard();
    conn.watchHistory();
    conn.watchExternal();
    conn.watchRuns();
    conn.watchRunEnv();
    conn.watchQuota();
    conn.watchBudgets();
    conn.watchVault();
    conn.connect();
  }

  getLatency = (hostId: string): number | null => this.latencies.get(hostId) ?? null;

  /** For the one component that shows a latency; a heartbeat never reaches the store's `subscribe`. */
  subscribeLatency = (listener: () => void): (() => void) => {
    this.latencyListeners.add(listener);
    return () => this.latencyListeners.delete(listener);
  };

  private setLatency(hostId: string, latencyMs: number | null): void {
    if (this.getLatency(hostId) === latencyMs) return;
    this.latencies.set(hostId, latencyMs);
    for (const listener of [...this.latencyListeners]) listener(); // NOSONAR: a listener may subscribe or unsubscribe while it runs: this pass goes over a copy
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

  /** The window coming back or the network returning is the moment to try the offline hosts. */
  listenForWake(): void {
    const target = wakeTarget();
    if (typeof target.addEventListener !== "function") return;
    const wake = () => {
      for (const conn of this.connections.values()) conn.wake();
      this.deps.onWake();
    };
    const visible = () => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") wake();
    };
    target.addEventListener("online", wake);
    target.addEventListener("focus", wake);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", visible);
    this.stopWake = () => {
      target.removeEventListener?.("online", wake);
      target.removeEventListener?.("focus", wake);
      if (typeof document !== "undefined")
        document.removeEventListener("visibilitychange", visible);
    };
  }

  /** Stops listening for wake-ups and closes every connection. */
  dispose(): void {
    this.stopWake?.();
    this.stopWake = null;
    for (const conn of this.connections.values()) conn.dispose();
    this.connections.clear();
  }
}
