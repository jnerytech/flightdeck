/**
 * Phase 39: an in-memory OpenCode ACP peer behind the `SpawnedAcp` interface, for the runtime's
 * tests (in-process, so coverage counts). It answers the client's requests from handlers (defaults
 * shaped like the recorded fixtures), holds `session/prompt` open until the test ends it, sends
 * updates and requests of its own, and records everything it received. Plus manual timers.
 */
import { AsyncQueue } from "../src/async-queue.ts";
import type { SpawnedAcp } from "../src/runtime/acp/client.ts";

export interface Received {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

export const MODEL_OPTIONS = ["anthropic/claude-sonnet-5-5", "opencode/crouton-alpha-free"];
export const EFFORT_OPTIONS = ["minimal", "low", "medium", "high", "xhigh", "max", "default"];

export function configOptions(
  current: { model?: string; effort?: string; mode?: string; modes?: string[] } = {},
) {
  return [
    {
      id: "model",
      category: "model",
      type: "select",
      currentValue: current.model ?? "opencode/crouton-alpha-free",
      options: MODEL_OPTIONS.map((value) => ({ value, name: value })),
    },
    {
      id: "effort",
      category: "thought_level",
      type: "select",
      currentValue: current.effort ?? "default",
      options: EFFORT_OPTIONS.map((value) => ({ value, name: value })),
    },
    {
      id: "mode",
      category: "mode",
      type: "select",
      currentValue: current.mode ?? "flightdeck",
      options: (current.modes ?? ["flightdeck", "flightdeck-plan"]).map((value) => ({
        value,
        name: value,
      })),
    },
  ];
}

type Handler = (params: Record<string, unknown>) => unknown;

export async function turns(count = 1): Promise<void> {
  for (let i = 0; i < count; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

export class FakeAcpAgent {
  readonly received: Received[] = [];
  readonly pid: number;
  killed = false;
  stdinClosed = false;
  /** Whether closing stdin ends the process (OpenCode does; a hung one does not). */
  exitOnStdinClose = true;
  private readonly lines = new AsyncQueue<string>();
  private exitCode: number | null = null;
  private resolveExit: (code: number) => void = () => {};
  readonly exited: Promise<number>;
  private nextAgentId = 100;
  private readonly agentRequests = new Map<number, (result: unknown) => void>();
  private readonly prompts: Array<{ id: number | string; sessionId: string }> = [];
  private state = { model: "opencode/crouton-alpha-free", effort: "default", mode: "flightdeck" };
  readonly handlers: Record<string, Handler>;

  constructor(
    readonly argv: string[],
    readonly opts: { cwd: string; env: Record<string, string> },
    pid = 4242,
  ) {
    this.pid = pid;
    this.exited = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
    this.handlers = {
      initialize: () => ({
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: true, embeddedContext: true },
        },
      }),
      "session/new": () => ({ sessionId: "ses_1", configOptions: configOptions(this.state) }),
      "session/resume": () => ({ configOptions: configOptions(this.state) }),
      "session/set_config_option": (p) => {
        this.state = { ...this.state, [p.configId as string]: p.value as string };
        return { configOptions: configOptions(this.state) };
      },
      "session/close": () => ({}),
    };
  }

  transport(): SpawnedAcp {
    return {
      lines: this.lines,
      write: (line) => this.onWrite(JSON.parse(line) as Received),
      close: () => {
        this.stdinClosed = true;
        if (this.exitOnStdinClose) this.exit(0);
      },
      kill: () => {
        this.killed = true;
        this.exit(137);
      },
      exited: this.exited,
      pid: this.pid,
    };
  }

  exit(code: number): void {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    this.lines.end();
    this.resolveExit(code);
  }

  get alive(): boolean {
    return this.exitCode === null;
  }

  private onWrite(msg: Received): void {
    this.received.push(msg);
    if (msg.method !== undefined && msg.id !== undefined) {
      if (msg.method === "session/prompt") {
        this.prompts.push({ id: msg.id, sessionId: String(msg.params?.sessionId) });
        return;
      }
      const handler = this.handlers[msg.method];
      if (!handler) return; // unanswered: a hung agent
      void Promise.resolve(handler(msg.params ?? {})).then(
        (result) => this.send({ jsonrpc: "2.0", id: msg.id, result }),
        (error: { code?: number; message?: string }) =>
          this.send({
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: error.code ?? -32603, message: error.message ?? "error" },
          }),
      );
    } else if (msg.method === undefined && typeof msg.id === "number") {
      this.agentRequests.get(msg.id)?.(msg.error ? { error: msg.error } : msg.result);
      this.agentRequests.delete(msg.id);
    }
  }

  send(message: unknown): void {
    if (this.alive) this.lines.push(JSON.stringify(message));
  }

  /** A `session/update` notification. */
  update(update: Record<string, unknown>, sessionId = "ses_1"): void {
    this.send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } });
  }

  /** A request of the agent's own; resolves with the client's answer. */
  ask(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextAgentId++;
    const answer = new Promise<unknown>((resolve) => this.agentRequests.set(id, resolve));
    this.send({ jsonrpc: "2.0", id, method, params });
    return answer;
  }

  /** Ends the oldest open `session/prompt`. */
  endPrompt(
    result: Record<string, unknown> = {
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 2 },
    },
  ): void {
    const prompt = this.prompts.shift();
    if (prompt) this.send({ jsonrpc: "2.0", id: prompt.id, result });
  }

  failPrompt(message: string, code = -32000): void {
    const prompt = this.prompts.shift();
    if (prompt) this.send({ jsonrpc: "2.0", id: prompt.id, error: { code, message } });
  }

  get openPrompts(): number {
    return this.prompts.length;
  }

  /** The params of every request with that method, in order. */
  calls(method: string): Array<Record<string, unknown>> {
    return this.received.filter((m) => m.method === method).map((m) => m.params ?? {});
  }
}

/** Timers driven by hand: `advance(ms)` fires what is due, in order. */
export function manualTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    set(fn: () => void, ms: number): unknown {
      const id = ++seq;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clear(handle: unknown): void {
      pending.delete(handle as number);
    },
    advance(ms: number): void {
      const until = now + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, t]) => t.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = until;
    },
    get count(): number {
      return pending.size;
    },
  };
}
