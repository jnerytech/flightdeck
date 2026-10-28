import {
  type Options,
  type PermissionResult,
  type SDKMessage,
  type SDKUserMessage,
  query as sdkQuery,
} from "@anthropic-ai/claude-agent-sdk";
import type { AssistantBlock } from "@flightdeck/protocol";
import { AsyncQueue } from "../async-queue.ts";
import { whichOnPath } from "../which.ts";
import type { AgentRun, AgentRuntime, RuntimeEvent, StartOptions } from "./types.ts";

/** The part of the SDK `Query` object this runtime uses. */
export interface QueryHandle extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<unknown>;
  close(): void;
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
}

const MAX_TOOL_RESULT = 4000;

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
  private readonly claudePath: string | undefined;

  constructor(options: ClaudeSdkRuntimeOptions = {}) {
    this.query = options.query ?? (sdkQuery as QueryFn);
    this.claudePath = resolveClaudePath(options.claudePath);
  }

  start(opts: StartOptions): AgentRun {
    const prompt = new AsyncQueue<SDKUserMessage>();
    const events = new AsyncQueue<RuntimeEvent>();
    const options: Options = {
      cwd: opts.cwd,
      permissionMode: opts.permissionMode,
      includePartialMessages: true,
      env: opts.env,
      settingSources: ["user", "project", "local"],
      systemPrompt: { type: "preset", preset: "claude_code" },
      canUseTool: async (toolName, input, ctx): Promise<PermissionResult> => {
        const decision = await opts.canUseTool(toolName, input, {
          signal: ctx.signal,
          toolUseId: ctx.toolUseID,
        });
        return decision.behavior === "allow"
          ? { behavior: "allow", updatedInput: decision.updatedInput ?? input }
          : { behavior: "deny", message: decision.message };
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
      send(text) {
        prompt.push({
          type: "user",
          parent_tool_use_id: null,
          message: { role: "user", content: text },
        });
      },
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
