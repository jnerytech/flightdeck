import type { SessionTrace } from "@flightdeck/protocol";

export interface TraceInput {
  claudeSessionId: string;
  /** The session's transcript. */
  main: string;
  /** Each subagent's transcript (`<session>/subagents/agent-<id>.jsonl`), by its id. */
  subagents: Array<{ id: string; text: string }>;
  /** The cost of an assistant message, by its id; `null` when it is not priced. */
  costOf(messageId: string): number | null;
  /** How long a tool call really took, when the telemetry (phase 23) has it. */
  toolMs?(toolUseId: string): number | null;
}

/**
 * The trace of a session: its turns, each with the tool calls, thoughts and subagents under it,
 * and what they cost and took. The transcript format is not a contract: a line or a field this
 * does not know is skipped.
 */
export function buildTrace(input: TraceInput): SessionTrace {
  return {
    claudeSessionId: input.claudeSessionId,
    turns: [],
    costUsd: null,
    durationMs: null,
    costliest: null,
    slowest: null,
  };
}
