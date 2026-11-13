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
export function queueStep(state: {
  working: boolean;
  closed: boolean;
  hasNext: boolean;
  awaiting: number | null;
  cards: number;
}): QueueStep {
  const { working, closed, hasNext, cards } = state;
  // The turn showed up (the session worked, or its user message reached the conversation).
  const awaiting =
    state.awaiting !== null && (working || cards > state.awaiting) ? null : state.awaiting;
  if (working || closed || !hasNext || awaiting !== null) return { awaiting, send: false };
  return { awaiting: cards, send: true };
}

/** What a press on Send does: nothing to send moves the cursor, a turn in progress queues, else it sends. */
export function submitAction(
  value: string,
  attached: number,
  working: boolean,
): "focus" | "queue" | "send" {
  if (!value && attached === 0) return "focus";
  return working ? "queue" : "send";
}

/**
 * Esc in the message box of a working session interrupts it. The key is marked handled: left
 * unmarked, it reaches SplitView and closes the detail too (#2591).
 */
export function interruptOnEscape(
  event: { key: string; preventDefault(): void },
  working: boolean,
  interrupt: () => Promise<unknown>,
): void {
  if (event.key !== "Escape" || !working) return;
  event.preventDefault();
  void interrupt();
}
