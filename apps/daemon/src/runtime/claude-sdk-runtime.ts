import { mkdirSync } from "node:fs";
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
import type { AssistantBlock } from "@flightdeck/protocol";
import { AsyncQueue } from "../async-queue.ts";
import { quotaReadings } from "../quota/quota.ts";
import { whichOnPath } from "../which.ts";
import type {
  AgentRun,
  AgentRuntime,
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
}

const MAX_TOOL_RESULT = 4000;

/** What the automatic approval's query must answer (phase 13). */
const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["allow", "ask"] },
    reason: { type: "string" },
  },
  required: ["decision", "reason"],
  additionalProperties: false,
};

/** An AbortController that follows a signal. */
function abortFrom(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  signal.addEventListener("abort", () => controller.abort(), { once: true });
  return controller;
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

function truncate(text: string): string {
  return text.length > MAX_TOOL_RESULT
    ? `${text.slice(0, MAX_TOOL_RESULT)}… [${text.length - MAX_TOOL_RESULT} caracteres omitidos]`
    : text;
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block: { type?: string; text?: string }) =>
        block.type === "text" ? (block.text ?? "") : `[${block.type ?? "bloco"}]`,
      )
      .join("\n");
  }
  return content === undefined ? "" : JSON.stringify(content);
}

/** Maps one SDK message to zero or more protocol events. Subagent traffic is left out. */
export function normalizeSdkMessage(message: SDKMessage): RuntimeEvent[] {
  switch (message.type) {
    case "system":
      if (message.subtype !== "init") return [];
      return [
        {
          type: "session.init",
          claudeSessionId: message.session_id,
          model: message.model,
          tools: message.tools,
        },
      ];
    case "stream_event": {
      if (message.parent_tool_use_id !== null) return [];
      const event = message.event;
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        return [{ type: "message.delta", text: event.delta.text }];
      }
      return [];
    }
    case "assistant": {
      if (message.parent_tool_use_id !== null) return [];
      const blocks: AssistantBlock[] = [];
      for (const block of message.message.content) {
        if (block.type === "text") blocks.push({ type: "text", text: block.text });
        else if (block.type === "tool_use") {
          blocks.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
        }
      }
      return blocks.length > 0 ? [{ type: "message.assistant", blocks }] : [];
    }
    case "user": {
      if (message.parent_tool_use_id !== null) return [];
      const content = message.message.content;
      if (typeof content === "string") return [];
      const events: RuntimeEvent[] = [];
      for (const block of content) {
        if (block.type !== "tool_result") continue;
        events.push({
          type: "tool.result",
          toolUseId: block.tool_use_id,
          content: truncate(toolResultText(block.content)),
          isError: block.is_error === true,
        });
      }
      return events;
    }
    case "rate_limit_event": {
      // The host's plan quota, read defensively (see quotaReadings).
      const windows = quotaReadings((message as { rate_limit_info?: unknown }).rate_limit_info);
      return windows.length > 0 ? [{ type: "quota", windows }] : [];
    }
    case "result":
      return [
        {
          type: "turn.result",
          subtype: message.subtype,
          isError: message.is_error,
          durationMs: message.duration_ms,
          costUsd: message.total_cost_usd,
          usage: {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
            cacheReadInputTokens: message.usage.cache_read_input_tokens,
            cacheCreationInputTokens: message.usage.cache_creation_input_tokens,
          },
        },
      ];
    default:
      return [];
  }
}

/**
 * Runs the official `claude` binary through `@anthropic-ai/claude-agent-sdk` in streaming-input
 * mode, so one process lives across turns.
 */
export class ClaudeSdkRuntime implements AgentRuntime {
  private readonly query: QueryFn;
  readonly claudePath: string | undefined;

  private readonly fork: NonNullable<ClaudeSdkRuntimeOptions["forkSession"]>;

  constructor(options: ClaudeSdkRuntimeOptions = {}) {
    this.query = options.query ?? (sdkQuery as QueryFn);
    this.fork = options.forkSession ?? sdkForkSession;
    this.claudePath = resolveClaudePath(options.claudePath);
  }

  /**
   * Phase 13: one short query, isolated: no settings (so no hooks), no session written, no tools,
   * one turn and a structured answer. Anything but a clear answer is a question for the user.
   */
  async judgePermission(opts: JudgeOptions): Promise<JudgeResult> {
    mkdirSync(opts.cwd, { recursive: true });
    const prompt = new AsyncQueue<SDKUserMessage>();
    prompt.push({
      type: "user",
      parent_tool_use_id: null,
      message: { role: "user", content: opts.prompt },
    });
    prompt.end();
    const handle = this.query({
      prompt,
      options: {
        model: opts.model,
        cwd: opts.cwd,
        maxTurns: 1,
        settingSources: [],
        persistSession: false,
        tools: [],
        env: { ...process.env, FLIGHTDECK_MANAGED: "1" },
        outputFormat: { type: "json_schema", schema: JUDGE_SCHEMA },
        ...(opts.signal ? { abortController: abortFrom(opts.signal) } : {}),
        ...(this.claudePath ? { pathToClaudeCodeExecutable: this.claudePath } : {}),
      },
    });
    for await (const message of handle) {
      if (message.type !== "result") continue;
      const usage = message.usage;
      const tokens = {
        model: opts.model,
        speed: "standard",
        input: usage.input_tokens,
        output: usage.output_tokens,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        cacheWrite5m: usage.cache_creation_input_tokens ?? 0,
        cacheWrite1h: 0,
      };
      const answer = message.subtype === "success" ? message.structured_output : undefined;
      const { decision, reason } = (answer ?? {}) as { decision?: unknown; reason?: unknown };
      return decision === "allow" || decision === "ask" || decision === "deny"
        ? { decision, reason: String(reason ?? ""), tokens }
        : { decision: "ask", reason: `resposta sem decisão (${message.subtype})`, tokens };
    }
    return { decision: "ask", reason: "a consulta terminou sem resultado" };
  }

  /** Phase 12: the SDK's forkSession; it writes the new transcript itself. */
  forkSession(claudeSessionId: string, options: ForkOptions): Promise<{ sessionId: string }> {
    return this.fork(claudeSessionId, options);
  }

  start(opts: StartOptions): AgentRun {
    const prompt = new AsyncQueue<SDKUserMessage>();
    const events = new AsyncQueue<RuntimeEvent>();
    const options: Options = {
      cwd: opts.cwd,
      permissionMode: opts.permissionMode,
      includePartialMessages: true,
      // Phase 12: copies of the files before each change, for rewindFiles.
      enableFileCheckpointing: true,
      // Hooks from the user's settings fire here too; the receptor ignores sessions marked so.
      env: { ...opts.env, FLIGHTDECK_MANAGED: "1" },
      settingSources: ["user", "project", "local"],
      systemPrompt: { type: "preset", preset: "claude_code" },
      canUseTool: async (toolName, input, ctx): Promise<PermissionResult> => {
        const decision = await opts.canUseTool(toolName, input, {
          signal: ctx.signal,
          toolUseId: ctx.toolUseID,
          suggestions: ctx.suggestions,
        });
        if (decision.behavior === "deny") return { behavior: "deny", message: decision.message };
        // Validated against the request (permission-updates.ts): same shape as the SDK's.
        const updatedPermissions = decision.updatedPermissions as SdkPermissionUpdate[] | undefined;
        return {
          behavior: "allow",
          updatedInput: decision.updatedInput ?? input,
          ...(updatedPermissions ? { updatedPermissions } : {}),
        };
      },
      ...(opts.resume ? { resume: opts.resume } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(this.claudePath ? { pathToClaudeCodeExecutable: this.claudePath } : {}),
    };
    const handle = this.query({ prompt, options });

    void (async () => {
      try {
        for await (const message of handle) {
          for (const event of normalizeSdkMessage(message)) events.push(event);
        }
        events.end();
      } catch (error) {
        events.fail(error);
      }
    })();

    return {
      events,
      send(text, uuid) {
        prompt.push({
          type: "user",
          parent_tool_use_id: null,
          message: { role: "user", content: text },
          ...(uuid ? { uuid: uuid as SDKUserMessage["uuid"] } : {}),
        });
      },
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
      async close() {
        prompt.end();
        events.end();
        handle.close();
      },
    };
  }
}
