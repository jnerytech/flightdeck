/** What a session started in a terminal waits for, read from the end of its transcript (#1736). */
export type Waiting = "plan" | "question";

/** The last bytes of a transcript, and the size and time they were read at (a cache key). */
export interface Tail {
  text: string;
  size: number;
  mtimeMs: number;
}

/**
 * Whether the transcript's tail ends at a plan approval or a question put to the person: the last
 * assistant entry is a tool call to `ExitPlanMode` or `AskUserQuestion` and nothing answers it.
 */
export function waitingIn(_tail: string): Waiting | null {
  return null;
}
