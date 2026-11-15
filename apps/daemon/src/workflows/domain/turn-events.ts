import type { RunUsage, SessionEvent, SessionStatus } from "@flightdeck/protocol";

/** What one event of a session means to the step that waits for its turn. */
export type TurnReaction =
  | { type: "status"; status: SessionStatus }
  /** The turn is over: its assistant text, its running cost, and why it failed (null when it did not). */
  | { type: "turn"; text: string; costUsd: number | undefined; failure: string | null }
  | { type: "failed"; message: string };

/**
 * Reads the events of one turn in order. It keeps the text blocks of every assistant message and
 * answers, per event, what the step must do; events that mean nothing to it answer `null`.
 */
export function turnReader(): (event: SessionEvent) => TurnReaction | null {
  const texts: string[] = [];
  return (event) => {
    if (event.type === "session.status") return { type: "status", status: event.status };
    if (event.type === "message.assistant") {
      for (const block of event.blocks) if (block.type === "text") texts.push(block.text);
      return null;
    }
    if (event.type === "turn.result") {
      return {
        type: "turn",
        text: texts.join("\n\n"),
        costUsd: event.costUsd,
        failure: event.isError ? `turno terminou com erro (${event.subtype})` : null,
      };
    }
    if (event.type === "session.error") return { type: "failed", message: event.message };
    return null;
  };
}

/** What a step has spent once one more turn is counted, `costAdded` being what the turn added. */
export function stepShare(before: RunUsage | null, minutes: number, costAdded: number): RunUsage {
  const share = before ?? { turns: 0, minutes: 0, costUsd: 0 };
  return {
    turns: share.turns + 1,
    minutes: share.minutes + minutes,
    costUsd: share.costUsd + costAdded,
  };
}
