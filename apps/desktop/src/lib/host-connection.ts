import {
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
  PROTOCOL_VERSION,
  parseServerMessage,
  type QuotaState,
  type SessionSubscribeResult,
  type TerminalData,
  type TerminalExited,
  type TerminalResync,
  type VaultRequestFrame,
  type WorkflowRun,
} from "@flightdeck/protocol";
import { backoffDelay } from "./backoff.ts";

/** Fire-and-forget commands: failures surface through the connection status instead. */
const ignore = () => {};

export type ConnectionStatus =
  | "connecting"
  | "online"
  | "offline"
  | "unauthorized"
  /** The daemon does not speak this app's protocol: no retries until it is updated. */
  | "incompatible";

export class RequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

export interface HostConnectionOptions {
  url: string;
  token: string;
  clientName: string;
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
  /** A workflow run of the host changed (after `watchRuns`). */
  onRunUpdated?(run: WorkflowRun): void;
  /** The host's plan quota changed (after `watchQuota`). */
  onQuotaUpdated?(state: QuotaState): void;
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
  private ws: WebSocket | null = null;
  private attempt = 0;
  private nextId = 0;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly subscriptions = new Set<string>();
  /** The review targets whose diff is watched (phase 11), asked for again after a reconnect. */
  private readonly changeTargets = new Set<string>();
  private watching = false;
  private watchingBoard = false;
  private watchingHistory = false;
  private watchingExternal = false;
  private watchingRuns = false;
  private watchingQuota = false;
  private watchingBudgets = false;

  constructor(private readonly opts: HostConnectionOptions) {}

  connect(): void {
    this.setStatus("connecting");
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;
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
          this.setStatus("online");
          if (this.watching) this.send("sessions.watch", {}).catch(ignore);
          // Daemons before phase 4 answer with an error: nothing to watch there.
          if (this.watchingBoard) this.send("board.watch", {}).catch(ignore);
          if (this.watchingHistory) this.send("history.watch", {}).catch(ignore);
          // While it watches, the daemon holds external permission requests for the app.
          if (this.watchingExternal) this.send("external.watch", {}).catch(ignore);
          // The runs still going come first, so open gates show up right away.
          if (this.watchingRuns) this.send("run.watch", {}).catch(ignore);
          if (this.watchingQuota) this.send("quota.watch", {}).catch(ignore);
          // Daemons before phase 8 have no budgets: the error is ignored.
          if (this.watchingBudgets) this.send("budget.watch", {}).catch(ignore);
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
      const message = parseServerMessage(String(msg.data));
      if (message.type === "event") return this.opts.onEvent(message);
      if (message.type === "card.updated") return this.opts.onCardUpdated?.(message.card);
      if (message.type === "history.changed") return this.opts.onHistoryChanged?.(message);
      if (message.type === "askpass.request") return this.opts.onAskpass?.(message);
      if (message.type === "vault.request") return this.opts.onVaultRequest?.(message);
      if (message.type === "run.updated") return this.opts.onRunUpdated?.(message.run);
      if (message.type === "quota.updated") {
        return this.opts.onQuotaUpdated?.({ windows: message.windows, pauseAt: message.pauseAt });
      }
      if (message.type === "budget.updated") return this.opts.onBudgetUpdated?.(message);
      if (message.type === "changes.updated") return this.opts.onChangesUpdated?.(message);
      if (
        message.type === "terminal.data" ||
        message.type === "terminal.exited" ||
        message.type === "terminal.resync"
      ) {
        return this.opts.onTerminal?.(message);
      }
      if (message.type === "external.updated" || message.type === "external.permission") {
        return this.opts.onExternal?.(message);
      }
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
      else pending?.reject(new RequestError(message.error.code, message.error.message));
    });
    ws.addEventListener("close", (event) => this.onClose(ws, event.code));
  }

  /** Sends a command once online; rejects with code `offline` otherwise. */
  request<T extends CommandType>(type: T, payload: CommandPayload<T>): Promise<CommandResults[T]> {
    if (this.status !== "online") {
      return Promise.reject(new RequestError("offline", "host offline"));
    }
    return this.send(type, payload);
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

  /** Streams `quota.updated` from the next (re)connect on; call it before `connect`. */
  watchQuota(): void {
    this.watchingQuota = true;
  }

  /** Streams `run.updated` from the next (re)connect on; call it before `connect`. */
  watchRuns(): void {
    this.watchingRuns = true;
  }

  unsubscribe(sessionId: string): void {
    this.subscriptions.delete(sessionId);
    this.request("session.unsubscribe", { sessionId }).catch(ignore);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
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

  private onClose(ws: WebSocket, code: number): void {
    if (ws !== this.ws) return;
    this.ws = null;
    for (const pending of this.pending.values())
      pending.reject(new RequestError("offline", "conexão perdida"));
    this.pending.clear();
    if (this.disposed) return;
    if (code === CLOSE_UNAUTHORIZED) {
      this.setStatus("unauthorized");
      return;
    }
    this.setStatus("offline");
    const delay = backoffDelay(this.attempt++, this.opts.baseDelayMs, this.opts.maxDelayMs);
    this.timer = setTimeout(() => this.connect(), delay);
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === this.status && status !== "connecting") return;
    this.status = status;
    this.opts.onStatus(status);
  }
}
