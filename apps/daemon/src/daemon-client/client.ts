/**
 * The daemon protocol as the host's own commands speak it to the local daemon (#1594): its address,
 * `hello`, then commands and acks.
 */
import {
  type Ack,
  type CommandPayload,
  type CommandResults,
  type CommandType,
  parseServerMessage,
  type ServerMessage,
  WS_PATH,
} from "@flightdeck/protocol";

/** Where the MCP server finds the daemon of this host. */
export function daemonUrl(config: { bind: string; port: number }): string {
  const any = config.bind === "0.0.0.0" || config.bind === "::";
  const host = any ? "127.0.0.1" : config.bind;
  const shown = host.includes(":") ? "[" + host + "]" : host;
  return `ws://${shown}:${config.port}${WS_PATH}`;
}

/** Nobody answers at the daemon's address (as opposed to a daemon that answers and refuses). */
export class DaemonUnreachable extends Error {
  constructor() {
    super("no response");
  }
}

/** The socket closed under a call; `code` is the close code the daemon gave (4401: it refused the token). */
export class ConnectionClosed extends Error {
  constructor(readonly code: number) {
    super("connection closed");
  }
}

/**
 * The daemon answered and refused. The message is `<code>: <text>`, as it always was; the parts are
 * kept so a command can word the refusals it knows (issue #3425).
 */
export class DaemonRefusal extends Error {
  constructor(
    readonly code: string,
    /** The daemon's own text, without the code. */
    readonly detail: string,
    /** The refusal's name when the app words it: `hold_required`, `permission_request_closed`. */
    readonly reason?: string,
  ) {
    super(`${code}: ${detail}`);
  }
}

/** The daemon protocol, as any client of the app speaks it: `hello`, then commands and acks. */
export class DaemonClient {
  private readonly acks = new Map<string, { ok(ack: Ack): void; fail(error: Error): void }>();
  private readonly listeners = new Set<(frame: ServerMessage) => void>();
  private seq = 0;
  /** The close code, once the socket closed: a stream waits on it to know the daemon went away. */
  readonly closed: Promise<number>;
  /** Rejects when the daemon sent a frame this version cannot read (a newer daemon, say). */
  readonly unreadable: Promise<never>;
  private reject!: (error: Error) => void;

  private constructor(private readonly ws: WebSocket) {
    this.unreadable = new Promise<never>((_, reject) => {
      this.reject = reject;
    });
    this.unreadable.catch(() => undefined); // only a stream reads it: no unhandled rejection otherwise
    ws.addEventListener("message", (msg) => {
      let frame: ServerMessage;
      try {
        frame = parseServerMessage(String(msg.data));
      } catch {
        const error = new Error("could not read a frame from the daemon: is it a newer version?");
        for (const pending of this.acks.values()) pending.fail(error);
        this.acks.clear();
        this.reject(error);
        return;
      }
      if (frame.type === "ping") ws.send(JSON.stringify({ type: "pong", id: frame.id }));
      if (frame.type === "ack") this.acks.get(frame.id)?.ok(frame);
      for (const listener of this.listeners) listener(frame);
    });
    this.closed = new Promise((resolve) => {
      ws.addEventListener("close", (event) => {
        for (const pending of this.acks.values()) pending.fail(new ConnectionClosed(event.code));
        this.acks.clear();
        resolve(event.code);
      });
    });
  }

  /**
   * Calls `listener` for every pushed frame of this type, from now on (a stream, #3454). Register it
   * before the request that starts the stream, so a frame sent right after the ack is not lost.
   */
  onFrame<T extends ServerMessage["type"]>(
    type: T,
    listener: (frame: Extract<ServerMessage, { type: T }>) => void,
  ): () => void {
    const each = (frame: ServerMessage) => {
      if (frame.type === type) listener(frame as Extract<ServerMessage, { type: T }>);
    };
    this.listeners.add(each);
    return () => void this.listeners.delete(each);
  }

  /** `signal` gives up: it closes the socket, so nothing is sent on a connection nobody waits for. */
  static async connect(
    url: string,
    token: string,
    name = "flightdeck-mcp",
    signal?: AbortSignal,
  ): Promise<DaemonClient> {
    const ws = new WebSocket(url);
    const abort = () => ws.close();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve(), { once: true });
        ws.addEventListener("error", () => reject(new DaemonUnreachable()), { once: true });
        ws.addEventListener("close", () => reject(new DaemonUnreachable()), { once: true });
      });
      const client = new DaemonClient(ws);
      await client.call("hello", { token, client: name });
      if (signal?.aborted) throw new Error("connection closed");
      return client;
    } catch (error) {
      // A hello the daemon refuses, or a wait that was given up, leaves no socket open.
      ws.close();
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  call<T extends CommandType>(type: T, payload: CommandPayload<T>): Promise<CommandResults[T]> {
    const id = String(++this.seq);
    return new Promise((resolve, reject) => {
      this.acks.set(id, {
        ok: (ack) => {
          this.acks.delete(id);
          if (ack.ok) resolve(ack.data as CommandResults[T]);
          else reject(new DaemonRefusal(ack.error.code, ack.error.message, ack.error.reason));
        },
        fail: reject,
      });
      this.ws.send(JSON.stringify({ id, type, payload }));
    });
  }

  close(): void {
    this.ws.close();
  }
}
