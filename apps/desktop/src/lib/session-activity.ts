import type { SessionState } from "./session-state.ts";

export type ToolGroup = "command" | "edit" | "read" | "search" | "web" | "agent" | "other";

/** What the session is doing right now, for the line above the message box. */
export type Activity =
  | { kind: "thinking" }
  | { kind: "writing" }
  | { kind: "waiting" }
  | { kind: "tool"; group: ToolGroup; tool: string };

const GROUPS: Record<string, ToolGroup> = {
  Bash: "command",
  BashOutput: "command",
  KillShell: "command",
  Edit: "edit",
  MultiEdit: "edit",
  Write: "edit",
  NotebookEdit: "edit",
  Read: "read",
  LS: "read",
  Grep: "search",
  Glob: "search",
  WebFetch: "web",
  WebSearch: "web",
  Task: "agent",
  Agent: "agent",
};

/** The request waiting for the user, else the tool still without a result, else the text or the thinking. */
export function activityOf(session: SessionState): Activity {
  if (session.status === "awaiting_permission") return { kind: "waiting" };
  for (let i = session.items.length - 1; i >= 0; i--) {
    const item = session.items[i];
    if (item?.kind !== "assistant") continue;
    for (let j = item.blocks.length - 1; j >= 0; j--) {
      const block = item.blocks[j];
      if (block?.type === "tool_use" && !session.toolResults[block.id]) {
        return { kind: "tool", group: GROUPS[block.name] ?? "other", tool: block.name };
      }
    }
    break;
  }
  return session.streaming !== "" ? { kind: "writing" } : { kind: "thinking" };
}
