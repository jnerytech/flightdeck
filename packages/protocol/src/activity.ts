import type { QuestionLanguage } from "./question.ts";

/** One tool call of a task, as the session recorded it. */
export interface ToolEvent {
  name: string;
  input: unknown;
}

export type ActivityKind = "reading" | "searching" | "writing" | "running" | "thinking" | "idle";

export interface TaskActivity {
  kind: ActivityKind;
  /** How many things the latest burst touched (files for reading and writing, steps otherwise). */
  count: number;
  /** One live sentence, never a tool name. */
  text: string;
}

/** What a task is doing, from its tool calls in order (the last one is the latest). */
export function taskActivity(
  _tools: readonly ToolEvent[],
  _language: QuestionLanguage,
  _working: boolean,
): TaskActivity {
  return { kind: "idle", count: 0, text: "" };
}
