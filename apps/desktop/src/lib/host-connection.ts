import {
  type AccountState,
  type AskpassRequest,
  type BudgetUpdated,
  type Card,
  type ChangesUpdated,
  CLOSE_UNAUTHORIZED,
  type CommandPayload,
  type CommandResults,
  type CommandType,
  type EventEnvelope,
  type ExternalPermissionFrame,
  type ExternalUpdated,
  type HelloResult,
  type HistoryChanged,
  type MessagesRelayFrame,
  type MessagesUpdatedFrame,
  type MessagingAlertFrame,
  PROTOCOL_VERSION,
  parseServerMessage,
  type QuotaState,
  type RuleIssue,
  type RunState,
  type ServerMessage,
  type SessionSubscribeResult,
  type TeamsUpdatedFrame,
  type TerminalData,
  type TerminalExited,
  type TerminalResync,
  type VaultAlertFrame,
  type VaultRequestFrame,
  type VaultUsed,
  type WatchUpdatedFrame,
  type WorkflowRun,
} from "@flightdeck/protocol";
import { backoffDelay } from "./backoff.ts";
import type { RetryState } from "./host-offline.ts";

/** Fire-and-forget commands: failures surface through the connection status instead. */
const ignore = () => {};

export type ConnectionStatus =
  | "connecting"
  | "online"
  | "offline"
  | "unauthorized"
  /** The daemon does not speak this app's protocol: no retries until it is updated. */
  | "incompatible";

/** Silence after which a link counts as dead: three of the daemon's 15 s heartbeats. */
export const STALE_MS = 45_000;

/** How long a connection may take to get its `hello` answered before it is given up. */
export const CONNECT_TIMEOUT_MS = 15_000;

/** The clock and the interval of the watchdog: the real ones unless a test drives them. */
const REAL_WATCHDOG = {
  now: () => Date.now(),
  repeat: (check: () => void, ms: number) => {
    const handle = setInterval(check, ms);
    return () => clearInterval(handle);
  },
};

export class RequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** Why, when the host sent one the app translates, with the values its text fills in. */
    readonly reason?: string,
    readonly params?: Record<string, string | number>,
    /** What is wrong in a list the person typed (a vault rule), one item per problem. */
    readonly items?: readonly RuleIssue[],
    /** The host that refused, when the connection knows its id. */
    readonly hostId?: string,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

/** Wake-ups closer than this to the last one that acted are ignored. */
const WAKE_DEBOUNCE_MS = 2000;

export interface HostConnectionOptions {
  url: string;
  token: string;
  clientName: string;
  /** The id of the host this connection belongs to: its refusals carry it. */
  hostId?: string;
  /** Called for every session event received (live or replayed). */
  onEvent(envelope: EventEnvelope): void;
  onStatus(status: ConnectionStatus): void;
  /** Subscription acknowledged; events up to `result.session.lastSeq` are replay. */
  onSubscribed(sessionId: string, result: SessionSubscribeResult): void;
  /** A heartbeat arrived; `latencyMs` may have changed. */
  onPing?(): void;
  /** A card changed on the host's board (after `watchBoard`). */
  onCardUpdated?(card: Card): void;
  /** A transcript of the host gained lines (after `watchHistory`). */
  onHistoryChanged?(change: HistoryChanged): void;
  onAskpass?(request: AskpassRequest): void;
  /** An external session or one of its permission requests changed (after `watchExternal`). */
  onExternal?(frame: ExternalUpdated | ExternalPermissionFrame): void;
  /** The daemon asks the app for a secret (phase 16); the app decides. */
  onVaultRequest?(request: VaultRequestFrame): void;
  onVaultUsed?(used: VaultUsed): void;
  /** Phase 19: a warning about a secret's use, even where a rule let it through. */
  onVaultAlert?(alert: VaultAlertFrame): void;
  /** Phase 21: a message for another host to carry, or a message's new state. */
  onMessages?(frame: MessagesRelayFrame | MessagesUpdatedFrame): void;
  /** Phase 21: a team changed (and why, when the daemon paused or resumed it). */
  onTeams?(frame: TeamsUpdatedFrame): void;
  /** Phase 21: the daemon paused a pair of sessions caught in a loop. */
  onMessagingAlert?(alert: MessagingAlertFrame): void;
  /** Phase 22: a card's PR watch changed (a round started or ended, or it needs you). */
  onWatch?(frame: WatchUpdatedFrame): void;
  /** A workflow run of the host changed (after `watchRuns`). */
  onRunUpdated?(run: WorkflowRun): void;
  /** A card's run environment changed (after `watchRunEnv`, phase 24). */
  onRunEnvUpdated?(state: RunState): void;
  /** The host's plan quota changed (after `watchQuota`). */
  onQuotaUpdated?(state: QuotaState): void;
  /** The host's Claude account changed (after `watchAccount`, phase 34). */
  onAccountUpdated?(state: AccountState): void;
  /** A budget changed, crossed a threshold or entered a new period (after `watchBudgets`). */
  onBudgetUpdated?(update: BudgetUpdated): void;
  /** The diff of a watched target changed on disk (after `watchChanges`, phase 11). */
  onChangesUpdated?(update: ChangesUpdated): void;
  /** A frame of an attached terminal (after `terminal.attach`, phase 14). */
  onTerminal?(frame: TerminalData | TerminalExited | TerminalResync): void;
  /** Last persisted seq the app has seen for a session; used to resubscribe without gaps. */
  lastSeqFor(sessionId: string): number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Least time between two `wake()` calls that do something (focus spam must not storm the host). */
  wakeDebounceMs?: number;
  /** Silence from the host after which the link counts as dead (the daemon pings every 15 s). */
  staleMs?: number;
  /** How long a connection may take to get its `hello` answered before it is given up. */
  connectTimeoutMs?: number;
  /** Test seam: the watchdog's clock and interval (the real ones when absent). */
  watchdog?: { now(): number; repeat(check: () => void, ms: number): () => void };
}

interface Pending {
  resolve(data: unknown): void;
  reject(error: RequestError): void;
}

/**
 * One WebSocket connection to a daemon. Authenticates with `hello`, reconnects with exponential
 * backoff and, once back online, resubscribes every tracked session from its last seen seq.
 */
export class HostConnection {
  status: ConnectionStatus = "offline";
  info: HelloResult | null = null;
  /** The daemon's explanation when the status is `incompatible`. */
  incompatibility: string | null = null;
  /** Round trip of the last heartbeat, as measured by the daemon. */
  latencyMs: number | null = null;
  /** Set while the host is offline and a try is scheduled; `null` otherwise. */
  retry: RetryState | null = null;
  /** When the current try started, and whether the watchdog (not the socket) ended it. */
  private triedAt = 0;
  private gaveUp = false;
  private lastWake = Number.NEGATIVE_INFINITY;
  private ws: WebSocket | null = null;
  private attempt = 0;
  private nextId = 0;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Stops the check that the host still speaks; set while a socket is open. */
  private stopCheck: (() => void) | null = null;
  private lastHeard = 0;
  /** The last check found the link silent for too long; the next one that does gives it up. */
  private suspect = false;
  private readonly pending = new Map<string, Pending>();
  private readonly subscriptions = new Set<string>();
  /** The review targets whose diff is watched (phase 11), asked for again after a reconnect. */
  private readonly changeTargets = new Set<string>();
  private watching = false;
  private watchingBoard = false;
  private watchingHistory = false;
  private watchingExternal = false;
  private watchingRuns = false;
  private watchingRunEnv = false;
  private watchingQuota = false;
  private watchingAccount = false;
  private watchingBudgets = false;
  private watchingVault = false;

  constructor(private readonly opts: HostConnectionOptions) {}

  connect(): void {
    this.triedAt = Date.now();
    this.gaveUp = false;
    this.setStatus("connecting");
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;
    this.startWatchdog(ws);
    ws.addEventListener("open", () => {
      const hello = {
        token: this.opts.token,
        client: this.opts.clientName,
        protocolVersion: PROTOCOL_VERSION,
      };
      this.send("hello", hello).then(
        (info) => {
          this.info = info;
          this.attempt = 0;
          this.retry = null;
          this.setStatus("online");
          if (this.watching) this.send("sessions.watch", {}).catch(ignore);
          // Daemons before phase 4 answer with an error: nothing to watch there.
          if (this.watchingBoard) this.send("board.watch", {}).catch(ignore);
          if (this.watchingHistory) this.send("history.watch", {}).catch(ignore);
          // While it watches, the daemon holds external permission requests for the app.
          if (this.watchingExternal) this.send("external.watch", {}).catch(ignore);
          // The runs still going come first, so open gates show up right away.
          if (this.watchingRuns) this.send("run.watch", {}).catch(ignore);
          if (this.watchingRunEnv) this.send("runenv.watch", {}).catch(ignore);
          if (this.watchingQuota) this.send("quota.watch", {}).catch(ignore);
          // Daemons before phase 34 have no account: the error is ignored.
          if (this.watchingAccount) this.send("account.watch", {}).catch(ignore);
          // Daemons before phase 8 have no budgets: the error is ignored.
          if (this.watchingBudgets) this.send("budget.watch", {}).catch(ignore);
          // Daemons before phase 17 have no vault requests: the error is ignored.
          if (this.watchingVault) this.send("vault.watch", {}).catch(ignore);
          for (const target of this.changeTargets) {
            this.send("changes.watch", { target }).catch(ignore);
          }
          for (const sessionId of this.subscriptions) this.sendSubscribe(sessionId);
        },
        (error: RequestError) => {
          if (error.code !== "protocol_incompatible") return;
          this.incompatibility = error.message;
          this.setStatus("incompatible");
          this.ws = null;
          ws.close();
        },
      );
    });
    ws.addEventListener("message", (msg) => {
      this.lastHeard = (this.opts.watchdog ?? REAL_WATCHDOG).now();
      this.suspect = false;
      const message = parseServerMessage(String(msg.data));
      if (this.forward(message)) return;
      if (message.type === "ping") {
        if (message.lastRttMs !== undefined) this.latencyMs = message.lastRttMs;
        ws.send(JSON.stringify({ type: "pong", id: message.id }));
        this.opts.onPing?.();
        return;
      }
      if (message.type !== "ack") return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.ok) pending?.resolve(message.data);
      else {
        const { code, message: text, reason, params, items } = message.error;
        pending?.reject(new RequestError(code, text, reason, params, items, this.opts.hostId));
      }
    });
    ws.addEventListener("close", (event) => this.onClose(ws, event.code));
  }

  /** Hands a pushed message to the callback that listens for its type; false for the ones handled here (ping, ack). */
  private forward(message: ServerMessage): boolean {
    const o = this.opts;
    switch (message.type) {
      case "event":
        o.onEvent(message);
        return true;
      case "card.updated":
        o.onCardUpdated?.(message.card);
        return true;
      case "history.changed":
        o.onHistoryChanged?.(message);
        return true;
      case "askpass.request":
        o.onAskpass?.(message);
        return true;
      case "vault.request":
        o.onVaultRequest?.(message);
        return true;
      case "vault.used":
        o.onVaultUsed?.(message);
        return true;
      case "vault.alert":
        o.onVaultAlert?.(message);
        return true;
      case "teams.updated":
        o.onTeams?.(message);
        return true;
      case "messaging.alert":
        o.onMessagingAlert?.(message);
        return true;
      case "watch.updated":
        o.onWatch?.(message);
        return true;
      case "messages.relay":
      case "messages.updated":
        o.onMessages?.(message);
        return true;
      case "run.updated":
        o.onRunUpdated?.(message.run);
        return true;
      case "runenv.updated":
        o.onRunEnvUpdated?.(message.state);
        return true;
      case "quota.updated":
        o.onQuotaUpdated?.({ windows: message.windows, pauseAt: message.pauseAt });
        return true;
      case "account.updated": {
        const { type: _type, ...state } = message;
        o.onAccountUpdated?.(state);
        return true;
      }
      case "budget.updated":
        o.onBudgetUpdated?.(message);
        return true;
      case "changes.updated":
        o.onChangesUpdated?.(message);
        return true;
      case "terminal.data":
      case "terminal.exited":
      case "terminal.resync":
        o.onTerminal?.(message);
        return true;
      case "external.updated":
      case "external.permission":
        o.onExternal?.(message);
        return true;
      default:
        return false;
    }
  }

  /**
   * The window came back or the network did: if the host is waiting out a backoff, try now and
   * start the backoff over. A connection that is online or already trying is left alone.
   */
  wake(): void {
    if (this.disposed || this.status !== "offline") return;
    const now = Date.now();
    if (now - this.lastWake < (this.opts.wakeDebounceMs ?? WAKE_DEBOUNCE_MS)) return;
    this.lastWake = now;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.attempt = 0;
    this.connect();
  }

  /** Sends a command once online; rejects with code `offline` otherwise. */
  request<T extends CommandType>(type: T, payload: CommandPayload<T>): Promise<CommandResults[T]> {
    if (this.status !== "online") {
      return Promise.reject(new RequestError("offline", "host offline"));
    }
    return this.send(type, payload);
  }

  /** Asks again from the last seq seen: the replay fills a hole in what arrived. */
  resync(sessionId: string): void {
    if (this.status === "online") this.sendSubscribe(sessionId);
  }

  /** Tracks a session: subscribes now if online and again after every reconnect. */
  subscribe(sessionId: string): void {
    if (this.subscriptions.has(sessionId)) return;
    this.subscriptions.add(sessionId);
    if (this.status === "online") this.sendSubscribe(sessionId);
  }

  /** Streams `changes.updated` for a target, again after each reconnect, until `unwatchChanges`. */
  watchChanges(target: string): void {
    if (this.changeTargets.has(target)) return;
    this.changeTargets.add(target);
    if (this.status === "online") this.send("changes.watch", { target }).catch(ignore);
  }

  unwatchChanges(target: string): void {
    if (!this.changeTargets.delete(target)) return;
    if (this.status === "online") this.send("changes.unwatch", { target }).catch(ignore);
  }

  /** Streams `session.summary` for every session of the host, again after each reconnect. */
  watch(): void {
    if (this.watching) return;
    this.watching = true;
    if (this.status === "online") this.send("sessions.watch", {}).catch(ignore);
  }

  /** Streams `card.updated` for every card of the host from the next (re)connect on; call it before `connect`. */
  watchBoard(): void {
    this.watchingBoard = true;
  }

  /** Streams `history.changed` from the next (re)connect on; call it before `connect`. */
  watchHistory(): void {
    this.watchingHistory = true;
  }

  /** Streams external sessions and their requests from the next (re)connect on. */
  watchExternal(): void {
    this.watchingExternal = true;
  }

  /** Streams `budget.updated` from the next (re)connect on; call it before `connect`. */
  watchBudgets(): void {
    this.watchingBudgets = true;
  }

  /** Streams the daemon's `vault.request` frames from the next (re)connect on (phase 17). */
  watchVault(): void {
    this.watchingVault = true;
  }

  /** Streams `quota.updated` from the next (re)connect on; call it before `connect`. */
  watchQuota(): void {
    this.watchingQuota = true;
  }

  /** Streams `account.updated` while the account card is on screen, again after each reconnect. */
  watchAccount(on: boolean): void {
    if (this.watchingAccount === on) return;
    this.watchingAccount = on;
    if (this.status === "online")
      this.send(on ? "account.watch" : "account.unwatch", {}).catch(ignore);
  }

  /** Streams `run.updated` from the next (re)connect on; call it before `connect`. */
  watchRuns(): void {
    this.watchingRuns = true;
  }

  /** Streams `runenv.updated` from the next (re)connect on; call it before `connect`. */
  watchRunEnv(): void {
    this.watchingRunEnv = true;
  }

  unsubscribe(sessionId: string): void {
    this.subscriptions.delete(sessionId);
    this.request("session.unsubscribe", { sessionId }).catch(ignore);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.stopWatchdog();
    this.ws?.close();
    this.setStatus("offline");
  }

  private sendSubscribe(sessionId: string): void {
    this.send("session.subscribe", { sessionId, sinceSeq: this.opts.lastSeqFor(sessionId) }).then(
      (result) => this.opts.onSubscribed(sessionId, result),
      ignore,
    );
  }

  private send<T extends CommandType>(
    type: T,
    payload: CommandPayload<T>,
  ): Promise<CommandResults[T]> {
    const id = String(++this.nextId);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: (data) => resolve(data as CommandResults[T]), reject });
      this.ws?.send(JSON.stringify({ id, type, payload }));
    });
  }

  /**
   * A link that dies without a close (a sleeping laptop, a cut cable) never fails a request by
   * itself, and a connection whose `hello` is never answered stays "connecting" for ever. After
   * `staleMs` of silence (`connectTimeoutMs` while connecting) the socket is given up as if it had
   * closed, so what waits on it fails and the app reconnects. One silent check is only a
   * suspicion: frames queued behind a starved page are read before the next check, and a link
   * that spoke in the meantime is kept.
   */
  private startWatchdog(ws: WebSocket): void {
    const clock = this.opts.watchdog ?? REAL_WATCHDOG;
    const staleMs = this.opts.staleMs ?? STALE_MS;
    const connectMs = this.opts.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
    this.lastHeard = clock.now();
    this.suspect = false;
    this.stopWatchdog();
    this.stopCheck = clock.repeat(
      () => {
        if (ws !== this.ws) return this.stopWatchdog();
        const limit = this.status === "online" ? staleMs : connectMs;
        if (clock.now() - this.lastHeard < limit) {
          this.suspect = false;
          return;
        }
        if (!this.suspect) {
          this.suspect = true;
          return;
        }
        this.gaveUp = true;
        this.onClose(ws, 1006);
        ws.close();
      },
      Math.max(10, Math.floor(Math.min(staleMs, connectMs) / 4)),
    );
  }

  private stopWatchdog(): void {
    this.stopCheck?.();
    this.stopCheck = null;
  }

  private onClose(ws: WebSocket, code: number): void {
    if (ws !== this.ws) return;
    this.ws = null;
    this.stopWatchdog();
    for (const pending of this.pending.values())
      pending.reject(new RequestError("offline", "connection lost"));
    this.pending.clear();
    if (this.disposed) return;
    if (code === CLOSE_UNAUTHORIZED) {
      this.setStatus("unauthorized");
      return;
    }
    const delay = backoffDelay(this.attempt++, this.opts.baseDelayMs, this.opts.maxDelayMs);
    // A browser socket only says that it closed: the story is told by what came before.
    let kind: "lost" | "timeout" | "refused" = this.gaveUp ? "timeout" : "refused";
    if (this.status === "online") kind = "lost";
    this.retry = { kind, lastTryAt: this.triedAt, nextRetryAt: Date.now() + delay };
    this.setStatus("offline");
    this.timer = setTimeout(() => this.connect(), delay);
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === this.status && status !== "connecting") return;
    this.status = status;
    this.opts.onStatus(status);
  }
}
