import { type PlainInfo, plainInfo, type ToolEvent } from "@flightdeck/protocol";
import type { SessionState } from "./session-state.ts";

export type TaskState = "working" | "waiting" | "done" | "stopped" | "failed";

/** Where a task is, in the words of simple mode: from its session's status and last result. */
export function taskState(_session: SessionState): TaskState {
  return "working";
}

/** The last thing Claude said, as plain text: the summary of a finished task. */
export function lastSummary(_session: SessionState): string {
  return "?";
}

/** The tool calls since the person's last message, in order. */
export function recentTools(_session: SessionState): ToolEvent[] {
  return [];
}

export interface Question {
  requestId: string;
  plain: PlainInfo;
}

/** The first request that waits for an answer, in plain words. */
export function pendingQuestion(_session: SessionState): Question | null {
  return null;
}

export { plainInfo };
