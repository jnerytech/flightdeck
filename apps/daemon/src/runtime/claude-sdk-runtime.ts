import {
  type McpServerStatus,
  type Options,
  type PermissionResult,
  type SDKMessage,
  type SDKUserMessage,
  type PermissionUpdate as SdkPermissionUpdate,
  forkSession as sdkForkSession,
  query as sdkQuery,
} from "@anthropic-ai/claude-agent-sdk";
import type { EffortLevel, PermissionMode } from "@flightdeck/protocol";
import { AsyncQueue, type UsageTokens, whichOnPath } from "../kernel/index.ts";
import { ClaudeOneShot } from "./claude-one-shot.ts";
import { describeCommands, type SdkSlashCommand } from "./domain/commands.ts";
import type { FlightdeckMcpServer } from "./domain/flightdeck-mcp.ts";
import { normalizeSdkMessage } from "./domain/sdk-events.ts";
import type {
  AgentRun,
  AgentRuntime,
  CompleteOptions,
  CompleteResult,
  ForkOptions,
  JudgeOptions,
  JudgeResult,
  RewindFilesResult,
  RuntimeEvent,
  StartOptions,
} from "./types.ts";

/** The part of the SDK `Query` object this runtime uses. */
export interface QueryHandle extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<unknown>;
  close(): void;
  rewindFiles?(userMessageId: string, opts?: { dryRun?: boolean }): Promise<RewindFilesResult>;
  toggleMcpServer?(name: string, enabled: boolean): Promise<void>;
  mcpServerStatus?(): Promise<McpServerStatus[]>;
  setPermissionMode?(mode: PermissionMode): Promise<void>;
  setModel?(model?: string): Promise<void>;
  applyFlagSettings?(settings: { effortLevel?: EffortLevel | null }): Promise<void>;
  supportedCommands?(): Promise<SdkSlashCommand[]>;
}

export type QueryFn = (params: {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Options;
}) => QueryHandle;

export interface ClaudeSdkRuntimeOptions {
  /** Path to the `claude` executable; see docs/DECISIONS.md. */
  claudePath?: string;
  /** Injected in tests; defaults to the SDK's `query`. */
  query?: QueryFn;
  /** Injected in tests; defaults to the SDK's `forkSession`. */
  forkSession?: (id: string, options: ForkOptions) => Promise<{ sessionId: string }>;
  /** The Flightdeck MCP server every session gets; none when absent. */
  mcpServer?: FlightdeckMcpServer;
  /** How long the init event waits for the SDK to describe the slash commands (3 s). */
  commandsTimeoutMs?: number;
}

export interface ProcessInfo {
  main: string;
  which: (bin: string) => string | null;
}

/**
 * Picks the `claude` executable: the configured one, else the one on PATH when running from a
 * `bun build --compile` binary (where the SDK's bundled CLI can't resolve), else the SDK default.
 */
export function resolveClaudePath(
  configured?: string,
  proc: Partial<ProcessInfo> = {},
): string | undefined {
  if (configured) return configured;
  const main = proc.main ?? Bun.main;
  const which = proc.which ?? whichOnPath;
  const compiled = main.includes("$bunfs") || main.includes("~BUN");
  return compiled ? (which("claude") ?? undefined) : undefined;
}

const COMMANDS_TIMEOUT_MS = 3000;

/**
 * The init event with the commands described, when the SDK can say in time; the names alone
 * otherwise (it fails or stalls: the session must not wait on it, since its events queue behind this).
 */
async function withCommands(
  event: Extract<RuntimeEvent, { type: "session.init" }>,
  handle: QueryHandle,
  timeoutMs: number,
): Promise<RuntimeEvent> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const late = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), timeoutMs);
    });
    const commands = await Promise.race([handle.supportedCommands?.(), late]);
    return commands ? { ...event, commands: describeCommands(commands) } : event;
  } catch {
    return event;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What the persona and the agents change in a session's options. `tools` is the set that is
 * available, so a persona can only take away; `allowedTools` would pre-approve tools, which a
 * persona never does.
 */
function personaOptions(opts: StartOptions): Partial<Options> {
  return {
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      ...(opts.persona ? { append: opts.persona.append } : {}),
    },
    ...(opts.agents ? { agents: opts.agents } : {}),
    ...(opts.persona?.effort ? { effort: opts.persona.effort } : {}),
    ...(opts.persona?.tools ? { tools: opts.persona.tools } : {}),
  };
}

/**
 * Runs the official `claude` binary through `@anthropic-ai/claude-agent-sdk` in streaming-input
 * mode, so one process lives across turns.
 */
export class ClaudeSdkRuntime implements AgentRuntime {
  private readonly query: QueryFn;
  readonly claudePath: string | undefined;
  private readonly mcpServer: FlightdeckMcpServer | undefined;
  private readonly commandsTimeoutMs: number;

  private readonly fork: NonNullable<ClaudeSdkRuntimeOptions["forkSession"]>;
  private readonly oneShot: ClaudeOneShot;

  constructor(options: ClaudeSdkRuntimeOptions = {}) {
    this.query = options.query ?? (sdkQuery as QueryFn);
    this.fork = options.forkSession ?? sdkForkSession;
    this.claudePath = resolveClaudePath(options.claudePath);
    this.mcpServer = options.mcpServer;
    this.commandsTimeoutMs = options.commandsTimeoutMs ?? COMMANDS_TIMEOUT_MS;
    this.oneShot = new ClaudeOneShot(this.query, this.claudePath);
  }

  judgePermission(opts: JudgeOptions): Promise<JudgeResult> {
    return this.oneShot.judgePermission(opts);
  }

  complete(opts: CompleteOptions): Promise<CompleteResult> {
    return this.oneShot.complete(opts);
  }

  /** Phase 12: the SDK's forkSession; it writes the new transcript itself. */
  forkSession(claudeSessionId: string, options: ForkOptions): Promise<{ sessionId: string }> {
    return this.fork(claudeSessionId, options);
  }

  /**
   * The Flightdeck MCP server, added to the user's and the project's servers, never instead of
   * them. The key is the one `claude mcp add flightdeck` uses, so a person who registered it by
   * hand still has one entry.
   */
  private mcpOption(opts: StartOptions): Pick<Options, "mcpServers"> {
    if (!this.mcpServer) return {};
    // The session's own id: the MCP server knows who is sending (phase 21).
    const session = opts.env.FLIGHTDECK_SESSION;
    return {
      mcpServers: {
        flightdeck: {
          type: "stdio" as const,
          command: this.mcpServer.command,
          args: this.mcpServer.args,
          ...(session ? { env: { FLIGHTDECK_SESSION: session } } : {}),
        },
      },
    };
  }

  /** Turns what the SDK says into the run's events, in order; the first failure ends the run. */
  private async pump(handle: QueryHandle, events: AsyncQueue<RuntimeEvent>): Promise<void> {
    try {
      for await (const message of handle) {
        for (const event of normalizeSdkMessage(message)) {
          events.push(
            event.type === "session.init"
              ? await /* NOSONAR: the events of a session are queued in the order they happened */ withCommands(
                  event,
                  handle,
                  this.commandsTimeoutMs,
                )
              : event,
          );
        }
      }
      events.end();
    } catch (error) {
      events.fail(error);
    }
  }

  start(opts: StartOptions): AgentRun {
    const prompt = new AsyncQueue<SDKUserMessage>();
    const events = new AsyncQueue<RuntimeEvent>();
    const options: Options = {
      cwd: opts.cwd,
      permissionMode: opts.permissionMode,
      // Lets the open session switch to bypassPermissions later; it bypasses nothing by itself.
      ...(opts.allowBypass ? { allowDangerouslySkipPermissions: true } : {}),
      includePartialMessages: true,
      // Phase 12: copies of the files before each change, for rewindFiles.
      enableFileCheckpointing: true,
      // Hooks from the user's settings fire here too; the receptor ignores sessions marked so.
      env: { ...opts.env, FLIGHTDECK_MANAGED: "1" },
      // A folder the person has not trusted brings no hooks, servers, settings or CLAUDE.md of its own
      // (issue #196); the user's own settings and the MCP server Flightdeck passes still load. A
      // worktree reads its project configuration from the main checkout, never from the branch.
      settingSources: opts.trust?.trusted === false ? ["user"] : ["user", "project", "local"],
      ...(opts.trust?.trusted === false ? { strictMcpConfig: true } : {}),
      ...(opts.trust?.configRoot ? { projectConfigRoot: opts.trust.configRoot } : {}),
      ...this.mcpOption(opts),
      ...personaOptions(opts),
      canUseTool: async (toolName, input, ctx): Promise<PermissionResult> => {
        const decision = await opts.canUseTool(toolName, input, {
          signal: ctx.signal,
          toolUseId: ctx.toolUseID,
          suggestions: ctx.suggestions,
        });
        if (decision.behavior === "deny") return { behavior: "deny", message: decision.message };
        // Validated against the request (permissions/domain/permission-updates.ts): same shape as
        // the SDK's.
        const updatedPermissions = decision.updatedPermissions as SdkPermissionUpdate[] | undefined;
        return {
          behavior: "allow",
          updatedInput: decision.updatedInput ?? input,
          ...(updatedPermissions ? { updatedPermissions } : {}),
        };
      },
      ...(opts.resume ? { resume: opts.resume } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.effort ? { effort: opts.effort } : {}),
      ...(this.claudePath ? { pathToClaudeCodeExecutable: this.claudePath } : {}),
    };
    const handle = this.query({ prompt, options });

    void this.pump(handle, events);

    return {
      events,
      send(text, uuid, images) {
        prompt.push({
          type: "user",
          parent_tool_use_id: null,
          message: {
            role: "user",
            content: images?.length
              ? [
                  ...images.map((image) => ({
                    type: "image" as const,
                    source: {
                      type: "base64" as const,
                      media_type: image.mediaType,
                      data: image.data,
                    },
                  })),
                  ...(text ? [{ type: "text" as const, text }] : []),
                ]
              : text,
          },
          ...(uuid ? { uuid: uuid as SDKUserMessage["uuid"] } : {}),
        });
      },
      setPermissionMode: (mode) =>
        (handle.setPermissionMode as NonNullable<QueryHandle["setPermissionMode"]>)(mode),
      setModel: (model) => (handle.setModel as NonNullable<QueryHandle["setModel"]>)(model),
      // The SDK's flag settings layer; null clears it, back to the model's default.
      setEffort: (effort) =>
        (handle.applyFlagSettings as NonNullable<QueryHandle["applyFlagSettings"]>)({
          effortLevel: effort ?? null,
        }),
      toggleMcpServer: (name, enabled) =>
        (handle.toggleMcpServer as NonNullable<QueryHandle["toggleMcpServer"]>)(name, enabled),
      // Only what the screen shows: the SDK adds server info and configuration.
      mcpServerStatus: async () =>
        (await (handle.mcpServerStatus as NonNullable<QueryHandle["mcpServerStatus"]>)()).map(
          ({ name, status, error }) => ({ name, status, ...(error ? { error } : {}) }),
        ),
      rewindFiles: (userMessageId, opts) =>
        (handle.rewindFiles as NonNullable<QueryHandle["rewindFiles"]>)(userMessageId, opts),
      async interrupt() {
        await handle.interrupt();
      },
      async close(/* NOSONAR: async by contract: a throw must reach the caller as a rejection */) {
        prompt.end();
        events.end();
        handle.close();
      },
    };
  }
}
