/**
 * Phase 39: OpenCode as an agent runtime, over ACP on the stdio of `opencode acp`, one process per
 * live session. A connection owns the process (spawn, initialize, new or resume, the checked mode,
 * model and effort, close and kill); the run owns the turns, the events and the idle reaper.
 */
import type { SessionImage } from "@flightdeck/protocol";
import { AsyncQueue } from "../async-queue.ts";
import { FlightdeckError } from "../errors.ts";
import {
  ACP_CLOSED,
  AcpClient,
  AcpError,
  REAL_TIMERS,
  type SpawnedAcp,
  spawnAcp,
} from "./acp/client.ts";
import type { FlightdeckMcpServer } from "./flightdeck-mcp.ts";
import { FLIGHTDECK_AGENT, FLIGHTDECK_PLAN_AGENT, opencodeEnv } from "./opencode-config.ts";
import {
  type AcpPromptResult,
  type AcpToolCall,
  type AcpUpdate,
  OpenCodeEvents,
} from "./opencode-events.ts";
import type { ScopeResult } from "./opencode-scope.ts";
import type { AgentRun, AgentRuntime, RuntimeEvent, StartOptions } from "./types.ts";

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** Ends the agent's process and what it started. */
export type Killer = (child: SpawnedAcp) => void;

export const IDLE_CLOSE_MS = 15 * 60_000;
export const INTERRUPT_ESCALATION_MS = 10_000;
/** How long `session/close` may take before stdin is closed, and then the process before a kill. */
const CLOSE_ANSWER_MS = 2_000;
const KILL_AFTER_MS = 3_000;
/** Permission modes an OpenCode session does not offer (ADR 39-3). */
const UNSUPPORTED_MODES = new Set(["acceptEdits", "dontAsk", "auto"]);
const OUR_MODES = [FLIGHTDECK_AGENT, FLIGHTDECK_PLAN_AGENT];
const AUTH_HELP = "OpenCode has no login for this provider: run `opencode auth login` on the host";

export interface OpenCodeRuntimeOptions {
  path: string;
  version: string;
  preflight: { check(cwd: string): Promise<{ configContent: string }> };
  scan: () => Promise<ScopeResult>;
  kill: Killer;
  spawn?: (argv: string[], opts: { cwd: string; env: Record<string, string> }) => SpawnedAcp;
  timers?: Timers;
  mcpServer?: FlightdeckMcpServer;
  idleMs?: number;
}

/** Windows: `taskkill /PID <pid> /T /F` takes the tree; elsewhere a kill of the process. */
export function treeKiller(platform: NodeJS.Platform, run: (argv: string[]) => void): Killer {
  return (child) =>
    platform === "win32" ? run(["taskkill", "/PID", String(child.pid), "/T", "/F"]) : child.kill();
}

interface ConfigOption {
  id: string;
  currentValue?: string;
  options?: Array<{ value: string }>;
}

function unsupported(mode: string): FlightdeckError {
  return new FlightdeckError(
    "invalid_state",
    `an OpenCode session does not offer ${mode}`,
    "runtime_unsupported",
    { feature: mode },
  );
}

const selected = (optionId: "once" | "reject") => ({ outcome: { outcome: "selected", optionId } });

function overridden(detail: string): FlightdeckError {
  return new FlightdeckError(
    "invalid_state",
    `OpenCode's mode is not Flightdeck's (${detail})`,
    "opencode_permissions_overridden",
    { detail },
  );
}

/** The `mode` options must be exactly our two agents, and the current one the one we set. */
function checkMode(options: ConfigOption[], expected?: string): void {
  const mode = options.find((option) => option.id === "mode");
  const values = (mode?.options ?? []).map((option) => option.value).sort();
  if (values.join(",") !== [...OUR_MODES].sort().join(","))
    throw overridden(`modes ${values.join(", ")}`);
  if (expected && mode?.currentValue !== expected) throw overridden(`mode ${mode?.currentValue}`);
}

interface ConnectionDeps {
  runtime: OpenCodeRuntimeOptions;
  cwd: string;
  env: Record<string, string>;
  mcpServers: unknown[];
  timers: Timers;
  onUpdate: (params: { update?: AcpUpdate }) => void;
  onPermission: (params: { toolCall: AcpToolCall }) => Promise<unknown>;
  onExit: (code: number) => void;
}

/** One `opencode acp` process and its session. */
class Connection {
  sessionId = "";
  model = "";
  private readonly proc: SpawnedAcp;
  private readonly client: AcpClient;
  private closing: Promise<void> | null = null;

  constructor(private readonly deps: ConnectionDeps) {
    this.proc = (deps.runtime.spawn ?? spawnAcp)([deps.runtime.path, "acp"], {
      cwd: deps.cwd,
      env: deps.env,
    });
    this.client = new AcpClient(this.proc, {
      requests: {
        "session/request_permission": (params) =>
          deps.onPermission(params as { toolCall: AcpToolCall }),
      },
      onNotification: (method, params) => {
        if (method === "session/update") deps.onUpdate(params as { update?: AcpUpdate });
      },
      timers: deps.timers,
    });
    void this.proc.exited.then((code) => {
      if (!this.closing) deps.onExit(code);
    });
  }

  async open(o: { resume?: string; mode: string; model?: string; effort?: string }): Promise<void> {
    const { cwd, mcpServers } = this.deps;
    await this.client.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
    let options: ConfigOption[];
    if (o.resume) {
      const resumed = await this.client.request<{ configOptions?: ConfigOption[] }>(
        "session/resume",
        {
          sessionId: o.resume,
          cwd,
          mcpServers,
        },
      );
      this.sessionId = o.resume;
      options = resumed.configOptions ?? [];
    } else {
      const created = await this.client.request<{
        sessionId: string;
        configOptions?: ConfigOption[];
      }>("session/new", { cwd, mcpServers });
      this.sessionId = created.sessionId;
      options = created.configOptions ?? [];
    }
    checkMode(options);
    options = await this.set("mode", o.mode, o.mode);
    if (o.model) options = await this.set("model", o.model, o.mode);
    const efforts = options.find((option) => option.id === "effort")?.options ?? [];
    if (o.effort && efforts.some((option) => option.value === o.effort)) {
      options = await this.set("effort", o.effort, o.mode);
    }
    this.model = options.find((option) => option.id === "model")?.currentValue ?? "";
  }

  /** Sets a config option and checks that the mode is still ours. */
  async set(configId: string, value: string, mode: string): Promise<ConfigOption[]> {
    const answer = await this.client.request<{ configOptions?: ConfigOption[] }>(
      "session/set_config_option",
      {
        sessionId: this.sessionId,
        configId,
        value,
      },
    );
    const options = answer.configOptions ?? [];
    checkMode(options, mode);
    return options;
  }

  prompt(blocks: unknown[]): Promise<AcpPromptResult> {
    return this.client.request<AcpPromptResult>(
      "session/prompt",
      { sessionId: this.sessionId, prompt: blocks },
      { timeoutMs: null },
    );
  }

  cancel(): void {
    this.client.notify("session/cancel", { sessionId: this.sessionId });
  }

  /** `session/close`, then stdin, then a kill if the process stays; once. */
  close(): Promise<void> {
    this.closing ??= (async () => {
      await this.client
        .request("session/close", { sessionId: this.sessionId }, { timeoutMs: CLOSE_ANSWER_MS })
        .catch(() => undefined);
      this.client.close();
      const timer = this.deps.timers.set(() => this.deps.runtime.kill(this.proc), KILL_AFTER_MS);
      await this.proc.exited;
      this.deps.timers.clear(timer);
    })();
    return this.closing;
  }
}

/** One Flightdeck session's run: its turns, its events, its idle reaper. */
class OpenCodeRun implements AgentRun {
  readonly events = new AsyncQueue<RuntimeEvent>();
  private readonly normalizer = new OpenCodeEvents();
  private readonly timers: Timers;
  private mode: string;
  private model: string | undefined;
  private effort: string | undefined;
  private permissionMode: StartOptions["permissionMode"];
  /** The open permission questions, by tool call id. */
  private readonly asking = new Map<string, AbortController>();
  private conn: Connection | null = null;
  private sessionId: string | undefined;
  private chain: Promise<void> = Promise.resolve();
  private idle: unknown = null;
  private escalation: unknown = null;
  private turnActive = false;
  private escalated = false;
  private stopped = false;
  private closing: Promise<void> | null = null;

  constructor(
    private readonly runtime: OpenCodeRuntimeOptions,
    private readonly opts: StartOptions,
  ) {
    this.timers = runtime.timers ?? REAL_TIMERS;
    this.permissionMode = opts.permissionMode;
    this.mode = opts.permissionMode === "plan" ? FLIGHTDECK_PLAN_AGENT : FLIGHTDECK_AGENT;
    const [model, variant] = (opts.model ?? "").split("#");
    this.model = model || undefined;
    this.effort = variant || opts.effort;
    this.sessionId = opts.resume;
    if (UNSUPPORTED_MODES.has(opts.permissionMode)) {
      this.fatal(unsupported(opts.permissionMode));
      return;
    }
    this.chain = this.connect().catch((error) => this.fatal(error));
  }

  send(text: string, _uuid?: string, images?: SessionImage[]): void {
    if (this.stopped) return;
    this.clearIdle();
    this.chain = this.chain
      .then(() => this.turn(text, images ?? []))
      .catch((error) => this.fatal(error));
  }

  async interrupt(): Promise<void> {
    for (const controller of this.asking.values()) controller.abort();
    const conn = this.conn;
    if (!this.turnActive || !conn) return;
    conn.cancel();
    this.escalation = this.timers.set(() => this.escalate(conn), INTERRUPT_ESCALATION_MS);
  }

  async setPermissionMode(mode: StartOptions["permissionMode"]): Promise<void> {
    if (UNSUPPORTED_MODES.has(mode)) throw unsupported(mode);
    this.permissionMode = mode;
    this.mode = mode === "plan" ? FLIGHTDECK_PLAN_AGENT : FLIGHTDECK_AGENT;
    await this.conn?.set("mode", this.mode, this.mode);
  }

  async setModel(model: string | undefined): Promise<void> {
    const [name, variant] = (model ?? this.opts.model ?? "").split("#");
    this.model = name || undefined;
    this.effort = variant || this.opts.effort;
    if (this.model) await this.conn?.set("model", this.model, this.mode);
    if (variant) await this.conn?.set("effort", variant, this.mode);
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      this.stopped = true;
      this.clearIdle();
      if (this.escalation !== null) this.timers.clear(this.escalation);
      const conn = this.conn;
      this.conn = null;
      await conn?.close();
      this.events.end();
    })();
    return this.closing;
  }

  private async connect(): Promise<void> {
    const { configContent } = await this.runtime.preflight.check(this.opts.cwd);
    const mcp = this.runtime.mcpServer;
    const session = this.opts.env.FLIGHTDECK_SESSION;
    const conn: Connection = new Connection({
      runtime: this.runtime,
      cwd: this.opts.cwd,
      env: opencodeEnv(this.opts.env, configContent),
      mcpServers: mcp
        ? [
            {
              name: "flightdeck",
              command: mcp.command,
              args: mcp.args,
              env: session ? [{ name: "FLIGHTDECK_SESSION", value: session }] : [],
            },
          ]
        : [],
      timers: this.timers,
      onUpdate: (params) => {
        if (params.update) this.push(this.normalizer.update(params.update));
      },
      onPermission: (params) => this.permission(params.toolCall),
      onExit: (code) => {
        if (conn === this.conn) this.fatal(new Error(`OpenCode exited with code ${code}`));
      },
    });
    this.conn = conn;
    await conn.open({
      ...(this.sessionId ? { resume: this.sessionId } : {}),
      mode: this.mode,
      ...(this.model ? { model: this.model } : {}),
      ...(this.effort ? { effort: this.effort } : {}),
    });
    this.sessionId = conn.sessionId;
  }

  private async turn(text: string, images: SessionImage[]): Promise<void> {
    if (!this.conn) await this.connect();
    const conn = this.conn as Connection;
    this.push(this.normalizer.init(conn.sessionId, conn.model));
    const blocks = [
      ...images.map((image) => ({ type: "image", mimeType: image.mediaType, data: image.data })),
      ...(text ? [{ type: "text", text }] : []),
    ];
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    this.turnActive = true;
    this.escalated = false;
    try {
      const result = await conn.prompt(blocks);
      if (!this.escalated) this.push(this.normalizer.promptEnded(result, elapsed()));
    } catch (error) {
      if (this.escalated) return;
      if (error instanceof AcpError && error.code === ACP_CLOSED) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const events = this.normalizer.promptFailed(message, elapsed());
      if (/auth_required/.test(message)) {
        events[events.length - 1] = {
          type: "session.error",
          code: "opencode_auth_required",
          message: AUTH_HELP,
        };
      }
      this.push(events);
    } finally {
      this.turnActive = false;
      if (this.escalation !== null) this.timers.clear(this.escalation);
      this.escalation = null;
      if (!this.stopped && this.conn === conn) this.armIdle();
    }
  }

  /**
   * A permission question: its card first (handled by the consumer before the question is stored),
   * then the broker. `always` is never answered: a saved rule would beat Flightdeck's `ask`.
   */
  private async permission(toolCall: AcpToolCall): Promise<unknown> {
    const { events, child, tool } = this.normalizer.permissionRequest(toolCall);
    if (child) return selected("reject");
    this.push(events);
    await this.events.idle();
    if (this.permissionMode === "bypassPermissions" && this.opts.allowBypass)
      return selected("once");
    const id = toolCall.toolCallId;
    const controller = new AbortController();
    this.asking.set(id, controller);
    try {
      const decision = await this.opts.canUseTool(tool.name, tool.input, {
        signal: controller.signal,
        toolUseId: id,
      });
      if (controller.signal.aborted) return { outcome: { outcome: "cancelled" } };
      if (decision.behavior === "allow") return selected("once");
      // OpenCode rejects every other pending request of the session with this one.
      for (const [other, sibling] of this.asking) if (other !== id) sibling.abort();
      return selected("reject");
    } finally {
      this.asking.delete(id);
    }
  }

  /** No answer to a cancel: the turn ends here and the process goes; the next send resumes. */
  private escalate(conn: Connection): void {
    this.escalation = null;
    this.escalated = true;
    this.push(this.normalizer.promptEnded({ stopReason: "cancelled" }, INTERRUPT_ESCALATION_MS));
    if (this.conn === conn) this.conn = null;
    void conn.close();
  }

  private armIdle(): void {
    this.clearIdle();
    this.idle = this.timers.set(() => {
      this.idle = null;
      const conn = this.conn;
      this.conn = null;
      void conn?.close();
    }, this.runtime.idleMs ?? IDLE_CLOSE_MS);
  }

  private clearIdle(): void {
    if (this.idle !== null) this.timers.clear(this.idle);
    this.idle = null;
  }

  private push(events: RuntimeEvent[]): void {
    for (const event of events) this.events.push(event);
  }

  private fatal(error: unknown): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clearIdle();
    const conn = this.conn;
    this.conn = null;
    void conn?.close();
    this.events.fail(error);
  }
}

export class OpenCodeRuntime implements AgentRuntime {
  constructor(private readonly opts: OpenCodeRuntimeOptions) {}

  /** The preflight of a folder (the session manager awaits it before a start or a resume). */
  async preflight(cwd: string): Promise<void> {
    await this.opts.preflight.check(cwd);
  }

  start(opts: StartOptions): AgentRun {
    return new OpenCodeRun(this.opts, opts);
  }
}
