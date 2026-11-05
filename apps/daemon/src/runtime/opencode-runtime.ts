/**
 * Phase 39: OpenCode as an agent runtime, over ACP on the stdio of `opencode acp`, one process per
 * live session. A connection owns the process (spawn, initialize, new or resume, the checked mode,
 * model and effort, close and kill); the run owns the turns, the events and the idle reaper.
 */
import { readFile, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SessionImage } from "@flightdeck/protocol";
import { AsyncQueue } from "../async-queue.ts";
import { FlightdeckError } from "../errors.ts";
import { isInside } from "../paths.ts";
import { credential } from "../permissions/risk.ts";
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
import { maskResource } from "./opencode-preflight.ts";
import type { ScopeResult } from "./opencode-scope.ts";
import type { AgentRun, AgentRuntime, RuntimeEvent, StartOptions } from "./types.ts";

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** Ends the agent's process and what it started; `force` is the second, harder try. */
export type Killer = (child: SpawnedAcp, force: boolean) => void;

export const IDLE_CLOSE_MS = 15 * 60_000;
export const INTERRUPT_ESCALATION_MS = 10_000;
/** How long `session/close` may take before stdin is closed, and then the process before a kill. */
const CLOSE_ANSWER_MS = 2_000;
const KILL_AFTER_MS = 3_000;
/** After the first kill, the forced one; after that, how long close() still waits for the exit. */
const FORCE_AFTER_MS = 2_000;
const GIVE_UP_MS = 5_000;
/** Permission modes an OpenCode session does not offer (ADR 39-3). */
const UNSUPPORTED_MODES = new Set(["acceptEdits", "dontAsk", "auto"]);
const OUR_MODES = [FLIGHTDECK_AGENT, FLIGHTDECK_PLAN_AGENT];
const AUTH_HELP = "OpenCode has no login for this provider: run `opencode auth login` on the host";

const AGENTS_MD = "AGENTS.md";
const AGENTS_MD_MAX = 64 * 1024;

/** Whether a path's real path (links followed) is inside the folder's and is not a credential. */
async function realInside(folder: string, path: string): Promise<boolean> {
  try {
    const [root, target] = await Promise.all([realpath(folder), realpath(path)]);
    return isInside(root, target) && !credential(target);
  } catch {
    return false;
  }
}

/**
 * The folder's own AGENTS.md as an embedded text resource for a new session's first prompt (project
 * config is off, so OpenCode does not read it). Text only: nothing in it is followed or run.
 */
async function agentsMd(
  cwd: string,
  resumed: boolean,
): Promise<{ block?: Record<string, unknown>; skipped?: boolean } | null> {
  if (resumed) return null;
  const path = join(cwd, AGENTS_MD);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return null;
  // A link out of the folder, or to a credential, would send that file to the model unasked.
  if (info.size > AGENTS_MD_MAX || !(await realInside(cwd, path))) return { skipped: true };
  const text = await readFile(path, "utf8");
  return {
    block: {
      type: "resource",
      resource: { uri: `file://${path}`, mimeType: "text/markdown", text },
    },
  };
}

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

/** The real kill of a process tree: a detached run and a signal to a process group. */
export const REAL_KILL_DEPS = {
  run(argv: string[]): void {
    Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  },
  killGroup(pid: number, signal: NodeJS.Signals): void {
    process.kill(-pid, signal);
  },
};

/**
 * Windows: `taskkill /PID <pid> /T /F` takes the tree. Elsewhere the child leads its own process
 * group, so the group gets SIGTERM, then SIGKILL when forced; the process alone if the group is gone.
 */
export function treeKiller(
  platform: NodeJS.Platform,
  deps: { run: (argv: string[]) => void; killGroup: (pid: number, signal: NodeJS.Signals) => void },
): (child: Pick<SpawnedAcp, "pid" | "kill">, force: boolean) => void {
  return (child, force) => {
    if (platform === "win32") {
      deps.run(["taskkill", "/PID", String(child.pid), "/T", "/F"]);
      return;
    }
    try {
      deps.killGroup(child.pid, force ? "SIGKILL" : "SIGTERM");
    } catch {
      child.kill();
    }
  };
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
const CANCELLED = { outcome: { outcome: "cancelled" } };

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
      const { timers, runtime } = this.deps;
      const handles: unknown[] = [];
      const { promise: gaveUp, resolve: giveUp } = Promise.withResolvers<void>();
      // A process that stays gets a kill, then a forced one; close() never waits forever.
      handles.push(
        timers.set(() => {
          runtime.kill(this.proc, false);
          handles.push(
            timers.set(() => {
              runtime.kill(this.proc, true);
              handles.push(timers.set(giveUp, GIVE_UP_MS));
            }, FORCE_AFTER_MS),
          );
        }, KILL_AFTER_MS),
      );
      await Promise.race([this.proc.exited, gaveUp]);
      for (const handle of handles) timers.clear(handle);
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
  private interrupted = false;
  /** Tool calls that asked a person (or the bypass), for the tripwire. */
  private readonly requested = new Set<string>();
  /** The cards shown, by call id: the tripwire names the tool. */
  private readonly tools = new Map<string, { name: string; input: unknown }>();
  /** The global scope as it was at connect (ADR 39-3). */
  private fingerprint = "";
  /** Whether the first prompt (and its AGENTS.md) went out. */
  private contextSent = false;
  private escalated = false;
  /** Turns started, so a late escalation knows whether its turn is still the current one. */
  private turnNo = 0;
  /** Sends waiting for their turn, and whether the next one was interrupted before it began. */
  private queued = 0;
  private starting = false;
  private cancelNext = false;
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
    // No process until the first send (an idle session costs nothing); the session manager ran
    // the preflight already, for its typed refusal.
    if (UNSUPPORTED_MODES.has(opts.permissionMode)) this.fatal(unsupported(opts.permissionMode));
  }

  send(text: string, _uuid?: string, images?: SessionImage[]): void {
    if (this.stopped) return;
    this.clearIdle();
    this.queued++;
    this.chain = this.chain
      .then(() => this.turn(text, images ?? []))
      .catch((error) => this.fatal(error));
  }

  async interrupt(): Promise<void> {
    for (const controller of this.asking.values()) controller.abort();
    const conn = this.conn;
    if (!this.turnActive || !conn) {
      // A turn still waiting for its start (or its process) is dropped when it begins.
      if (this.queued > 0 || this.starting) this.cancelNext = true;
      return;
    }
    this.interrupted = true;
    if (this.escalation !== null) return;
    const turn = this.turnNo;
    conn.cancel();
    this.escalation = this.timers.set(() => this.escalate(conn, turn), INTERRUPT_ESCALATION_MS);
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
      for (const controller of this.asking.values()) controller.abort();
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
    if (this.stopped) return;
    this.fingerprint = (await this.runtime.scan()).fingerprint;
    if (this.stopped) return;
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
        if (params.update) this.onUpdate(params.update);
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
    // A close() while it opened already closed this connection (it is `this.conn` from the start),
    // and the turn that waits on it sees `stopped`.
    this.sessionId = conn.sessionId;
  }

  private async turn(text: string, images: SessionImage[]): Promise<void> {
    this.queued--;
    if (this.stopped || this.dropInterrupted()) return;
    if (!this.conn) {
      this.starting = true;
      await this.connect().finally(() => {
        this.starting = false;
      });
      if (this.stopped || !this.conn || this.dropInterrupted()) return;
    }
    const conn = this.conn as Connection;
    const context = this.contextSent
      ? null
      : await agentsMd(this.opts.cwd, this.opts.resume !== undefined);
    this.contextSent = true;
    this.push(
      this.normalizer.init(conn.sessionId, conn.model, {
        ...(context?.block ? { files: [AGENTS_MD] } : {}),
        ...(context?.skipped ? { skipped: [AGENTS_MD] } : {}),
      }),
    );
    const blocks = [
      ...(context?.block ? [context.block] : []),
      ...images.map((image) => ({ type: "image", mimeType: image.mediaType, data: image.data })),
      // ADR 39-2: a text that starts with `/` would run a command's shell blocks without a question.
      ...(text
        ? [{ type: "text", text: text.trimStart().startsWith("/") ? `\u200b${text}` : text }]
        : []),
    ];
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    this.turnActive = true;
    this.turnNo++;
    this.interrupted = false;
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
    const id = toolCall.toolCallId;
    this.requested.add(id);
    // Registered before the barrier, so a sibling's deny or an interrupt reaches it there too.
    const controller = new AbortController();
    this.asking.set(id, controller);
    try {
      this.push(events);
      await this.events.idle();
      if (this.stopped || controller.signal.aborted) return CANCELLED;
      if (this.permissionMode === "bypassPermissions" && this.opts.allowBypass)
        return selected("once");
      if (await this.readInside(tool.name, tool.input)) return selected("once");
      const decision = await this.opts.canUseTool(tool.name, tool.input, {
        signal: controller.signal,
        toolUseId: id,
      });
      if (controller.signal.aborted) return CANCELLED;
      if (decision.behavior === "allow") return selected("once");
      // OpenCode rejects every other pending request of the session with this one.
      for (const [other, sibling] of this.asking) if (other !== id) sibling.abort();
      return selected("reject");
    } finally {
      this.asking.delete(id);
    }
  }

  /**
   * Review M8: OpenCode's "inside the folder" is lexical, so a symlink in a repo could lead a read
   * out of it. Reads, globs and greps ask in OpenCode, and Flightdeck allows them here only when
   * the real path is inside the folder's real path and is not a credential.
   */
  private async readInside(name: string, input: Record<string, unknown>): Promise<boolean> {
    if (!["Read", "Glob", "Grep"].includes(name)) return false;
    const raw = input.file_path ?? input.path ?? ".";
    if (typeof raw !== "string" || credential(raw)) return false;
    return realInside(this.opts.cwd, resolve(this.opts.cwd, raw));
  }

  /** An interrupt that came before the turn began: it ends as cancelled, with no prompt. */
  private dropInterrupted(): boolean {
    if (!this.cancelNext) return false;
    this.cancelNext = false;
    this.push(this.normalizer.promptEnded({ stopReason: "cancelled" }, 0));
    return true;
  }

  /** No answer to a cancel: the turn ends here and the process goes; the next send resumes. */
  private escalate(conn: Connection, turn: number): void {
    this.escalation = null;
    if (turn !== this.turnNo || !this.turnActive) return;
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
    for (const event of events) {
      if (event.type === "message.assistant") {
        for (const block of event.blocks) {
          if (block.type === "tool_use")
            this.tools.set(block.id, { name: block.name, input: block.input });
        }
      }
      this.events.push(event);
      if (event.type === "tool.result" && !event.isError) this.afterTool(event.toolUseId);
    }
  }

  /** ADR 39-3: OpenCode's mode must stay ours. */
  private onUpdate(update: AcpUpdate): void {
    if (update.sessionUpdate === "config_option_update") {
      try {
        checkMode((update.configOptions as ConfigOption[] | undefined) ?? [], this.mode);
      } catch (error) {
        this.violate(error);
        return;
      }
    }
    if (update.sessionUpdate === "current_mode_update" && update.currentModeId !== this.mode) {
      this.violate(overridden(`mode ${String(update.currentModeId)}`));
      return;
    }
    this.push(this.normalizer.update(update));
  }

  /** After a tool ran: the tripwire, then the global scope's fingerprint. */
  private afterTool(id: string): void {
    const tool = this.tools.get(id) as { name: string; input: Record<string, unknown> } | undefined;
    const input = tool?.input ?? {};
    const path = (input.file_path ?? input.path) as string | undefined;
    const quietRead =
      ["Read", "Glob", "Grep"].includes(tool?.name ?? "") &&
      (!path || isInside(this.opts.cwd, resolve(this.opts.cwd, path)));
    if (!this.requested.has(id) && !this.interrupted && !quietRead) {
      const what = String(input.command ?? path ?? input.url ?? "");
      this.violate(overridden(`${tool?.name ?? id} ${maskResource(what)} ran without a question`));
      return;
    }
    void this.runtime.scan().then((scope) => {
      if (scope.fingerprint !== this.fingerprint)
        this.violate(overridden("global OpenCode config changed"));
    });
  }

  /** Something outranked Flightdeck: stop the turn and the session. */
  private violate(error: unknown): void {
    this.conn?.cancel();
    this.fatal(error);
  }

  private fatal(error: unknown): void {
    // Whatever happens, the process and the open questions go.
    for (const controller of this.asking.values()) controller.abort();
    const conn = this.conn;
    this.conn = null;
    void conn?.close();
    if (this.stopped) return;
    this.stopped = true;
    this.clearIdle();
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
