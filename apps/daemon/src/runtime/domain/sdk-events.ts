import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AssistantBlock } from "@flightdeck/protocol";
import { quotaReadings } from "../../quota/index.ts";
import type { RuntimeEvent } from "../types.ts";
import { truncateToolResult } from "./tool-result.ts";

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

type Message<T extends SDKMessage["type"]> = Extract<SDKMessage, { type: T }>;

function initEvents(message: Message<"system">): RuntimeEvent[] {
  if (message.subtype !== "init") return [];
  return [
    {
      type: "session.init",
      claudeSessionId: message.session_id,
      model: message.model,
      tools: message.tools,
      ...(message.slash_commands ? { slashCommands: message.slash_commands } : {}),
    },
  ];
}

function deltaEvents(message: Message<"stream_event">): RuntimeEvent[] {
  if (message.parent_tool_use_id !== null) return [];
  const event = message.event;
  if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
    return [{ type: "message.delta", text: event.delta.text }];
  }
  return [];
}

function assistantEvents(message: Message<"assistant">): RuntimeEvent[] {
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

function toolResultEvents(message: Message<"user">): RuntimeEvent[] {
  if (message.parent_tool_use_id !== null) return [];
  const content = message.message.content;
  if (typeof content === "string") return [];
  const events: RuntimeEvent[] = [];
  for (const block of content) {
    if (block.type !== "tool_result") continue;
    events.push({
      type: "tool.result",
      toolUseId: block.tool_use_id,
      content: truncateToolResult(toolResultText(block.content)),
      isError: block.is_error === true,
    });
  }
  return events;
}

function resultEvents(message: Message<"result">): RuntimeEvent[] {
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
}

/** Maps one SDK message to zero or more protocol events. Subagent traffic is left out. */
export function normalizeSdkMessage(message: SDKMessage): RuntimeEvent[] {
  switch (message.type) {
    case "system":
      return initEvents(message);
    case "stream_event":
      return deltaEvents(message);
    case "assistant":
      return assistantEvents(message);
    case "user":
      return toolResultEvents(message);
    case "rate_limit_event": {
      // The host's plan quota, read defensively (see quotaReadings).
      const windows = quotaReadings((message as { rate_limit_info?: unknown }).rate_limit_info);
      return windows.length > 0 ? [{ type: "quota", windows }] : [];
    }
    case "result":
      return resultEvents(message);
    default:
      return [];
  }
}
