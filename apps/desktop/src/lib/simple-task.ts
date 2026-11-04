import { type PlainInfo, plainInfo, type ToolEvent } from "@flightdeck/protocol";
import type { SessionState } from "./session-state.ts";

export type TaskState = "working" | "waiting" | "done" | "stopped" | "failed";

const lastResult = (session: SessionState) =>
  [...session.items].reverse().find((item) => item.kind === "result");

/** Where a task is, in the words of simple mode: from its session's status and last result. */
export function taskState(session: SessionState): TaskState {
  const result = lastResult(session);
  const failed = result?.kind === "result" && result.isError;
  switch (session.status) {
    case "awaiting_permission":
      return "waiting";
    case "error":
      return "failed";
    case "ended":
      return failed ? "failed" : "stopped";
    case "idle":
      return failed ? "failed" : result ? "done" : "working";
    default:
      return "working";
  }
}

/** The last thing Claude said, as plain text: the summary of a finished task. */
export function lastSummary(session: SessionState): string {
  for (let i = session.items.length - 1; i >= 0; i--) {
    const item = session.items[i];
    if (item?.kind !== "assistant") continue;
    const text = item.blocks.flatMap((block) => (block.type === "text" ? [block.text] : []));
    if (text.length > 0) return text.join("\n\n");
  }
  return "";
}

/** The tool calls since the person's last message, in order. */
export function recentTools(session: SessionState): ToolEvent[] {
  const tools: ToolEvent[] = [];
  for (let i = session.items.length - 1; i >= 0; i--) {
    const item = session.items[i];
    if (item?.kind === "user") break;
    if (item?.kind !== "assistant") continue;
    const calls = item.blocks.flatMap((block) =>
      block.type === "tool_use" ? [{ name: block.name, input: block.input }] : [],
    );
    tools.unshift(...calls);
  }
  return tools;
}

export interface Question {
  requestId: string;
  plain: PlainInfo;
}

/** The first request that waits for an answer, in plain words. */
export function pendingQuestion(session: SessionState): Question | null {
  for (const item of session.items) {
    if (
      item.kind !== "permission" ||
      item.resolution ||
      !session.pending.includes(item.requestId)
    ) {
      continue;
    }
    return {
      requestId: item.requestId,
      plain:
        item.plain ??
        plainInfo({
          toolName: item.toolName,
          input: item.input,
          ...(item.risk ? { risk: item.risk } : {}),
        }),
    };
  }
  return null;
}
