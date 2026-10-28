import {
  CLOSE_UNAUTHORIZED,
  type CommandPayload,
  type CommandResults,
  type CommandType,
  type EventEnvelope,
  type HelloResult,
  parseServerMessage,
  type SessionSubscribeResult,
} from "@flightdeck/protocol";
import { backoffDelay } from "./backoff.ts";

/** Fire-and-forget commands: failures surface through the connection status instead. */
const ignore = () => {};

export type ConnectionStatus = "connecting" | "online" | "offline" | "unauthorized";

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
  /** Round trip of the last heartbeat, as measured by the daemon. */
  latencyMs: number | null = null;
  private ws: WebSocket | null = null;
  private attempt = 0;
  private nextId = 0;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly subscriptions = new Set<string>();
  private watching = false;

  constructor(private readonly opts: HostConnectionOptions) {}

  connect(): void {
    this.setStatus("connecting");
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.send("hello", { token: this.opts.token, client: this.opts.clientName }).then((info) => {
        this.info = info;
        this.attempt = 0;
        this.setStatus("online");
        if (this.watching) this.send("sessions.watch", {}).catch(ignore);
        for (const sessionId of this.subscriptions) this.sendSubscribe(sessionId);
      }, ignore);
    });
    ws.addEventListener("message", (msg) => {
      const message = parseServerMessage(String(msg.data));
      if (message.type === "event") return this.opts.onEvent(message);
      if (message.type === "ping") {
        if (message.lastRttMs !== undefined) this.latencyMs = message.lastRttMs;
        ws.send(JSON.stringify({ type: "pong", id: message.id }));
        this.opts.onPing?.();
        return;
      }
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

  /** Streams `session.summary` for every session of the host, again after each reconnect. */
  watch(): void {
    if (this.watching) return;
    this.watching = true;
    if (this.status === "online") this.send("sessions.watch", {}).catch(ignore);
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
