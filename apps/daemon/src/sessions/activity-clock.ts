import type { SessionEvent } from "@flightdeck/protocol";

/** The last tool a session called, and whether that call (or another) is still open. */
export interface ToolNote {
  name: string | null;
  inFlight: boolean;
}

/**
 * When each session last produced an event of any kind (a streamed delta included, which the store
 * never persists) and which tool call it has open. The stall watcher reads it.
 */
export class ActivityClock {
  observe(_sessionId: string, _event: SessionEvent, _at: number): void {}

  /** Milliseconds since the epoch of the last event; `null` for a session never observed. */
  lastEventAt(_sessionId: string): number | null {
    return null;
  }

  tool(_sessionId: string): ToolNote {
    return { name: null, inFlight: false };
  }

  forget(_sessionId: string): void {}
}
