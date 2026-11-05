/**
 * Phase 39: ACP traffic of one OpenCode session, as Flightdeck session events. A pure normalizer
 * with state per run: the text kept per message (deltas are not stored), the tool names by call id
 * (only the first `tool_call` carries one), the calls already shown, and the session's running cost.
 * Child sessions' traffic (`_meta["opencode/child-session"]`, a `<child>:` call id) is left out.
 */
import { type MappedTool, mapOpenCodeTool } from "./opencode-tools.ts";
import { truncateToolResult } from "./tool-result.ts";
import type { RuntimeEvent } from "./types.ts";

export interface AcpToolCall {
  toolCallId: string;
  name?: string;
  status?: string;
  rawInput?: Record<string, unknown> | null;
  content?: unknown;
  _meta?: Record<string, unknown> | null;
}

export interface AcpUpdate extends Partial<AcpToolCall> {
  sessionUpdate: string;
  [key: string]: unknown;
}

export interface AcpPromptResult {
  stopReason: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedReadTokens?: number;
    cachedWriteTokens?: number;
  };
}

const CHILD_META = "opencode/child-session";

/** Whether an update or a tool call belongs to a child session. */
export function isChild(item: {
  toolCallId?: string;
  _meta?: Record<string, unknown> | null;
}): boolean {
  return Boolean(item._meta?.[CHILD_META]) || /^ses_[^:]*:/.test(item.toolCallId ?? "");
}

/** The text blocks of a tool's content; a diff alone becomes `[diff <path>]`. */
function resultText(content: unknown): string {
  const blocks = Array.isArray(content) ? (content as Array<Record<string, unknown>>) : [];
  const texts = blocks.flatMap((block) => {
    const inner = block.content as { type?: string; text?: string } | undefined;
    return block.type === "content" && inner?.type === "text" ? [inner.text ?? ""] : [];
  });
  if (texts.length > 0) return texts.join("\n");
  return blocks
    .map((block) => `[${String(block.type)} ${String(block.path ?? "")}]`.replace(" ]", "]"))
    .join("\n");
}

export class OpenCodeEvents {
  private initialized = false;
  private text = "";
  private messageId: string | undefined;
  private readonly names = new Map<string, string>();
  private readonly shown = new Set<string>();
  private costUsd: number | undefined;

  /** `session.init`, once per run, when its first prompt goes out. */
  init(sessionId: string, model: string): RuntimeEvent[] {
    if (this.initialized) return [];
    this.initialized = true;
    return [{ type: "session.init", claudeSessionId: sessionId, model, tools: [] }];
  }

  update(update: AcpUpdate): RuntimeEvent[] {
    if (isChild(update)) return [];
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const chunk = (update.content as { type?: string; text?: string } | undefined) ?? {};
        if (chunk.type !== "text" || !chunk.text) return [];
        const id = typeof update.messageId === "string" ? update.messageId : undefined;
        const out = id && this.messageId && id !== this.messageId ? this.flush() : [];
        if (id) this.messageId = id;
        this.text += chunk.text;
        return [...out, { type: "message.delta", text: chunk.text }];
      }
      case "tool_call": {
        const id = update.toolCallId as string;
        if (update.name) this.names.set(id, update.name);
        return this.flush();
      }
      case "tool_call_update": {
        const id = update.toolCallId as string;
        const out: RuntimeEvent[] = [];
        const input =
          update.rawInput && Object.keys(update.rawInput).length > 0 ? update.rawInput : null;
        const done = update.status === "completed" || update.status === "failed";
        if (input || done) out.push(...this.card(id, input ?? {}));
        if (done) {
          out.push({
            type: "tool.result",
            toolUseId: id,
            content: truncateToolResult(resultText(update.content)),
            isError: update.status === "failed",
          });
        }
        return out;
      }
      case "usage_update": {
        const amount = (update.cost as { amount?: unknown } | undefined)?.amount;
        if (typeof amount === "number") this.costUsd = amount;
        return [];
      }
      default:
        return [];
    }
  }

  /** A permission request's tool call: its card (when not shown yet) and the name and input to ask about. */
  permissionRequest(toolCall: AcpToolCall): {
    events: RuntimeEvent[];
    child: boolean;
    tool: MappedTool;
  } {
    const name = toolCall.name ?? this.names.get(toolCall.toolCallId) ?? "";
    const tool = mapOpenCodeTool(name, toolCall.rawInput ?? {});
    if (isChild(toolCall)) return { events: [], child: true, tool };
    if (toolCall.name) this.names.set(toolCall.toolCallId, toolCall.name);
    return { events: this.card(toolCall.toolCallId, toolCall.rawInput ?? {}), child: false, tool };
  }

  promptEnded(result: AcpPromptResult, durationMs: number): RuntimeEvent[] {
    const usage = result.usage ?? {};
    const success = result.stopReason === "end_turn";
    return [
      ...this.flush(),
      {
        type: "turn.result",
        subtype: success
          ? "success"
          : result.stopReason === "cancelled"
            ? "error_during_execution"
            : result.stopReason,
        isError: !success,
        durationMs,
        ...(this.costUsd !== undefined ? { costUsd: this.costUsd } : {}),
        usage: {
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          ...(usage.cachedReadTokens !== undefined
            ? { cacheReadInputTokens: usage.cachedReadTokens }
            : {}),
          ...(usage.cachedWriteTokens !== undefined
            ? { cacheCreationInputTokens: usage.cachedWriteTokens }
            : {}),
        },
      },
    ];
  }

  /** The prompt failed with a JSON-RPC error. */
  promptFailed(message: string, durationMs: number): RuntimeEvent[] {
    return [
      ...this.flush(),
      { type: "turn.result", subtype: "error", isError: true, durationMs },
      { type: "session.error", code: "runtime", message },
    ];
  }

  /** The kept text as the assistant's message, if any. */
  private flush(): RuntimeEvent[] {
    const text = this.text;
    this.text = "";
    this.messageId = undefined;
    return text ? [{ type: "message.assistant", blocks: [{ type: "text", text }] }] : [];
  }

  /** The call's card, once. */
  private card(id: string, input: Record<string, unknown>): RuntimeEvent[] {
    if (this.shown.has(id)) return [];
    this.shown.add(id);
    const tool = mapOpenCodeTool(this.names.get(id) ?? "", input);
    return [
      {
        type: "message.assistant",
        blocks: [{ type: "tool_use", id, name: tool.name, input: tool.input }],
      },
    ];
  }
}
