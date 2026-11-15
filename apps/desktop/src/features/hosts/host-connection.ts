import {
  CLOSE_UNAUTHORIZED,
  type CommandPayload,
  type CommandResults,
  type CommandType,
  type HelloResult,
  PROTOCOL_VERSION,
  parseServerMessage,
  type RuleIssue,
} from "@flightdeck/protocol";
import { backoffDelay } from "../../shared/lib/backoff.ts";
import type { RetryState } from "./domain/host-offline.ts";
import { routeFrame } from "./frame-router.ts";
import type { ConnectionStatus, HostConnectionOptions } from "./host-connection-options.ts";

export type { ConnectionStatus, HostConnectionOptions };

/** Fire-and-forget commands: failures surface through the connection status instead. */
const ignore = () => {};

/** What ended a link (#939): the socket's close code and reason, or the watchdog giving up. */
export interface Drop {
  code: number;
  reason: string;
  byWatchdog: boolean;
  /** The app let go of the link itself (it was removed, or the app is closing). */
  byApp: boolean;
  /** How long nothing had come from the host when the link went down. */
  silentMs: number;
  /** How long the link had been up when it went down (#1532). */
  upMs: number;
  /** How long since the host's last heartbeat ping; null when none came on this link. */
  pingMs: number | null;
  /** Whether the link was online, or still trying to get there. */
  wasOnline: boolean;
}

/** Silence after which a link counts as dead: three of the daemon's 15 s heartbeats. */
const STALE_MS = 45_000;

/** How long a connection may take to get its `hello` answered before it is given up. */
const CONNECT_TIMEOUT_MS = 15_000;

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
  /** Why the link last went down (#939): what the log tells of a drop. */
  lastDrop: Drop | null = null;
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
  /** #1532: when this socket's watchdog started, and when the host's last heartbeat ping came. */
  private connectedAt = 0;
  private lastPingAt: number | null = null;
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
          if (this.watching) this.watchSessions();
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
      if (routeFrame(this.opts, message)) return;
      if (message.type === "ping") {
        this.lastPingAt = this.lastHeard;
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
    ws.addEventListener("close", (event) => this.onClose(ws, event.code, event.reason));
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
    if (this.status === "online") this.watchSessions();
  }

  /**
   * Asks for the summaries: in the ack, all at once, from a host that offers it (#1191), so the
   * app renders once for a host's sessions and not once for each; else one frame each.
   */
  private watchSessions(): void {
    if (this.info?.features?.includes("watch.snapshot")) {
      this.send("sessions.watch", { snapshot: "ack" }).then((result) => {
        if (result?.summaries) this.opts.onSummaries?.(result.summaries);
      }, ignore);
      return;
    }
    this.send("sessions.watch", {}).catch(ignore);
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
    // Letting go of a live link is the app's own close; with none, there is nothing to tell.
    this.lastDrop = this.ws ? this.dropOf(1000, "", true) : null;
    this.ws?.close();
    this.setStatus("offline");
  }

  /** How many requests were sent and not answered yet. */
  get inFlight(): number {
    return this.pending.size;
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
    this.connectedAt = this.lastHeard;
    this.lastPingAt = null;
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

  /** What the log tells of a link that ended now: the code, who ended it, and the clocks (#939, #1532). */
  private dropOf(code: number, reason: string, byApp: boolean): Drop {
    const now = (this.opts.watchdog ?? REAL_WATCHDOG).now();
    const { token } = this.opts;
    // The host chooses the reason: one plain line without the token, so it cannot forge lines in the log.
    const hidden = token ? reason.split(token).join("[token]") : reason;
    return {
      code,
      reason: hidden.replaceAll(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").slice(0, 123),
      byWatchdog: this.gaveUp,
      byApp,
      silentMs: now - this.lastHeard,
      upMs: now - this.connectedAt,
      pingMs: this.lastPingAt === null ? null : now - this.lastPingAt,
      wasOnline: this.status === "online",
    };
  }

  private onClose(ws: WebSocket, code: number, reason = ""): void {
    if (ws !== this.ws) return;
    // Letting go of the link (dispose) already told its own story.
    if (!this.disposed) this.lastDrop = this.dropOf(code, reason, false);
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
