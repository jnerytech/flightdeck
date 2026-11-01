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
  return {
    push: (envelope) => options.deliver(envelope),
    drain: () => {},
    stop: () => {},
  };
}

/** `ws.drain`: the socket has room again, so every subscription of the client sends what waited. */
export function drainAll(_ws: { data: { coalescers: Iterable<DeltaCoalescer> } }): void {}
