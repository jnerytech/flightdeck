import type { SessionState } from "./session-state.ts";

/** What the session is doing right now, for the line above the message box. */
export type Activity =
  | { kind: "thinking" }
  | { kind: "writing" }
  | { kind: "waiting" }
  | {
      kind: "tool";
      group: "command" | "edit" | "read" | "search" | "web" | "agent" | "other";
      tool: string;
    };

export function activityOf(_session: SessionState): Activity {
  return { kind: "thinking" };
}
