/**
 * Phase 39: a JSON-RPC 2.0 client for the Agent Client Protocol over a child's stdio, one message
 * per line. Flightdeck is the client; the agent (`opencode acp`) answers requests, sends
 * notifications and makes requests of its own (a permission question), which `requests` answers.
 * Nothing it reads or writes is logged: prompts and tool output stay out of the logs.
 */
import { linesOf } from "../../lines.ts";

/** The JSON-RPC codes this client sends or produces itself. */
export const ACP_METHOD_NOT_FOUND = -32601;
export const ACP_INTERNAL_ERROR = -32603;
/** The request got no answer in time. */
export const ACP_TIMEOUT = -32001;
/** The agent's process went away with the request pending. */
export const ACP_CLOSED = -32002;

export const ACP_DEFAULT_TIMEOUT_MS = 30_000;

export class AcpError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "AcpError";
  }
}

export interface AcpTransport {
  /** The agent's lines; the iteration ends when its stdout closes. */
  lines: AsyncIterable<string>;
  write(line: string): void;
  /** Closes the agent's stdin. */
  close(): void;
}

export interface AcpClientOptions {
  /** Answers the agent's requests by method; any other method gets "method not found". */
  requests?: Record<string, (params: unknown) => Promise<unknown>>;
  onNotification?: (method: string, params: unknown) => void;
  /** Per request, unless the call says otherwise; 30 s when absent. */
  timeoutMs?: number;
  /** Protocol problems, never a message's content. */
  log?: (message: string) => void;
  /** Injected in tests; the real timers when absent. */
  timers?: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
}

export const REAL_TIMERS = {
  set: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
  clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface Pending {
  resolve: (result: unknown) => void;
  reject: (error: AcpError) => void;
  timer: unknown;
}

interface Message {
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

export class AcpClient {
  /** Settles when the agent's stdout closes. */
  readonly closed: Promise<void>;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private ended = false;

  constructor(
    private readonly transport: AcpTransport,
    private readonly opts: AcpClientOptions = {},
  ) {
    this.closed = this.read();
  }

  /** `timeoutMs: null` waits for as long as it takes (a prompt turn). */
  request<T>(
    method: string,
    params: unknown,
    opts: { timeoutMs?: number | null } = {},
  ): Promise<T> {
    if (this.ended) return Promise.reject(new AcpError(ACP_CLOSED, "the agent has exited"));
    const id = this.nextId++;
    const timeoutMs =
      opts.timeoutMs === undefined
        ? (this.opts.timeoutMs ?? ACP_DEFAULT_TIMEOUT_MS)
        : opts.timeoutMs;
    return new Promise<T>((resolve, reject) => {
      const timer =
        timeoutMs === null
          ? null
          : (this.opts.timers ?? REAL_TIMERS).set(() => {
              this.pending.delete(id);
              reject(new AcpError(ACP_TIMEOUT, `${method} got no answer in ${timeoutMs} ms`));
            }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (r: unknown) => void, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  close(): void {
    this.transport.close();
  }

  private send(message: Record<string, unknown>): void {
    this.transport.write(JSON.stringify(message));
  }

  private async read(): Promise<void> {
    for await (const line of this.transport.lines) {
      if (line.trim() === "") continue;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        this.opts.log?.("acp: ignored a line that is not JSON");
        continue;
      }
      if (message === null || typeof message !== "object" || Array.isArray(message)) {
        this.opts.log?.("acp: ignored a message that is not an object");
        continue;
      }
      // A handler that throws (a shape nobody expected) costs that message, never the reading.
      try {
        this.dispatch(message as Message);
      } catch {
        this.opts.log?.("acp: a handler failed on a message");
      }
    }
    this.ended = true;
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      if (pending.timer !== null) (this.opts.timers ?? REAL_TIMERS).clear(pending.timer);
      pending.reject(new AcpError(ACP_CLOSED, "the agent exited before answering"));
    }
  }

  private dispatch(message: Message): void {
    if (typeof message.method === "string") {
      if (message.id === undefined || message.id === null) {
        this.opts.onNotification?.(message.method, message.params);
      } else {
        void this.answer(message.id, message.method, message.params);
      }
      return;
    }
    const pending = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
    if (!pending) {
      this.opts.log?.("acp: ignored an answer to an unknown request");
      return;
    }
    this.pending.delete(message.id as number);
    if (pending.timer !== null) (this.opts.timers ?? REAL_TIMERS).clear(pending.timer);
    if (message.error) {
      pending.reject(
        new AcpError(message.error.code ?? ACP_INTERNAL_ERROR, message.error.message ?? "error"),
      );
    } else {
      pending.resolve(message.result);
    }
  }

  private async answer(id: number | string, method: string, params: unknown): Promise<void> {
    const handler = this.opts.requests?.[method];
    if (!handler) {
      this.send({
        jsonrpc: "2.0",
        id,
        error: { code: ACP_METHOD_NOT_FOUND, message: "method not found" },
      });
      return;
    }
    try {
      this.send({ jsonrpc: "2.0", id, result: await handler(params) });
    } catch (error) {
      this.send({
        jsonrpc: "2.0",
        id,
        error:
          error instanceof AcpError
            ? { code: error.code, message: error.message }
            : { code: ACP_INTERNAL_ERROR, message: "internal error" },
      });
    }
  }
}

export interface SpawnedAcp extends AcpTransport {
  kill(): void;
  exited: Promise<number>;
  /** For a tree kill on Windows (`taskkill /PID <pid> /T /F`). */
  pid: number;
}

/** Starts the agent with piped stdio; its stderr is dropped (it may echo prompts). */
export function spawnAcp(
  argv: string[],
  opts: { cwd: string; env: Record<string, string> },
): SpawnedAcp {
  const child = Bun.spawn(argv, {
    cwd: opts.cwd,
    env: opts.env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
    // Its own process group on POSIX, so a tree kill reaches what it started.
    detached: process.platform !== "win32",
  });
  return {
    lines: linesOf(child.stdout),
    write(line) {
      child.stdin.write(`${line}\n`);
      void child.stdin.flush();
    },
    close() {
      void child.stdin.end();
    },
    kill() {
      child.kill();
    },
    exited: child.exited,
    pid: child.pid,
  };
}
