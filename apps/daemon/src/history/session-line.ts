import type { SessionLine } from "@flightdeck/protocol";

/** First non-empty line of a prompt, cut to `REQUEST_MAX` characters. */
export const REQUEST_MAX = 80;

export function requestLine(text: string): string {
  const first = text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!first) return "";
  return first.length > REQUEST_MAX ? `${first.slice(0, REQUEST_MAX - 1)}…` : first;
}

/** The last `[ferramenta X]` of an assistant message, as the indexer stores tool calls. */
export function lastTool(text: string): string | null {
  const calls = [...text.matchAll(/^\[ferramenta (.+)\]$/gm)];
  return calls.at(-1)?.[1] ?? null;
}

export interface LiveState {
  state: SessionLine["state"];
  /** Waiting: the tool asking for approval. */
  waitingTool?: string | null;
  since: string | null;
}

/** The request comes from the transcript; the state from what the daemon knows live. */
export function sessionLine(
  transcript: { request: string | null; tool: string | null } | null,
  live: LiveState,
): SessionLine {
  const tool =
    live.state === "running"
      ? (transcript?.tool ?? null)
      : live.state === "waiting"
        ? (live.waitingTool ?? null)
        : null;
  return { request: transcript?.request ?? null, state: live.state, tool, since: live.since };
}
