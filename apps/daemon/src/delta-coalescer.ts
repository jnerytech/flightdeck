import type { EventEnvelope } from "@flightdeck/protocol";

/** How long a client's `message.delta` text waits to be sent as one frame. */
export const DELTA_WINDOW_MS = 25;

export interface DeltaCoalescer {
  /** The next envelope of the session, in order. */
  push(envelope: EventEnvelope): void;
  /** The socket has room again (Bun's `drain`): sends what waited for it. */
  drain(): void;
  /** Forgets what waits and cancels the timer. */
  stop(): void;
}

export interface CoalescerOptions {
  /** Sends one frame. */
  deliver(envelope: EventEnvelope): void;
  /** Bytes the socket holds and has not sent (`ws.getBufferedAmount()`). */
  backlog(): number;
  /** Starts a timer; tests drive it by hand. */
  schedule?(run: () => void, ms: number): () => void;
  windowMs?: number;
}

/**
 * One client's view of one session's events: the text of `message.delta` events that come close
 * together goes out as one frame, in order, and any other event sends the pending text first.
 */
export function coalesceDeltas(options: CoalescerOptions): DeltaCoalescer {
  const { deliver, backlog } = options;
  const windowMs = options.windowMs ?? DELTA_WINDOW_MS;
  const schedule =
    options.schedule ??
    ((run: () => void, ms: number) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    });
  /** The envelope of the text that waits, with the text so far. */
  let pending: EventEnvelope | null = null;
  let cancel: (() => void) | null = null;

  const stopTimer = () => {
    cancel?.();
    cancel = null;
  };
  const flush = () => {
    stopTimer();
    if (!pending) return;
    const envelope = pending;
    pending = null;
    deliver(envelope);
  };
  // A socket that has not drained keeps the text here, growing, until `drain`: more frames in its
  // queue would only widen the gap it is already behind.
  const onTimer = () => {
    cancel = null;
    if (backlog() === 0) flush();
  };

  return {
    push(envelope) {
      if (envelope.event.type !== "message.delta") {
        flush();
        deliver(envelope);
        return;
      }
      pending =
        pending && pending.event.type === "message.delta"
          ? {
              ...envelope,
              event: { type: "message.delta", text: pending.event.text + envelope.event.text },
            }
          : envelope;
      cancel ??= schedule(onTimer, windowMs);
    },
    drain() {
      if (backlog() === 0) flush();
    },
    stop() {
      stopTimer();
      pending = null;
    },
  };
}

/** `ws.drain`: the socket has room again, so every subscription of the client sends what waited. */
export function drainAll(ws: { data: { coalescers: Iterable<DeltaCoalescer> } }): void {
  for (const coalescer of ws.data.coalescers) coalescer.drain();
}
