/** What the queue of messages written during a turn does next. */
export interface QueueStep {
  /** The cards count the last sent message waits to see grow, or null when nothing is awaited. */
  awaiting: number | null;
  /** The next queued message goes out now. */
  send: boolean;
}

/**
 * Messages written during a turn wait and go out, in order, as the turns end: one at a time, and
 * only once the one before it has shown up (the session worked, or its message reached the conversation).
 */
export function queueStep(_state: {
  working: boolean;
  closed: boolean;
  hasNext: boolean;
  awaiting: number | null;
  cards: number;
}): QueueStep {
  return { awaiting: 0, send: true };
}

/** What a press on Send does: nothing to send moves the cursor, a turn in progress queues, else it sends. */
export function submitAction(
  _value: string,
  _attached: number,
  _working: boolean,
): "focus" | "queue" | "send" {
  return _working ? "send" : "queue";
}
