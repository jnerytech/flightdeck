/**
 * Phase 21: "tell me when that session finishes its turn", once. The watcher gets a notice from
 * Flightdeck when the target session goes idle (the end of a managed turn, the Stop of a terminal),
 * at once when it already is, and never a second time for the same subscription.
 */
import type { SessionIdentity } from "@flightdeck/protocol";
import type { Endpoints } from "./endpoints.ts";
import type { Messaging } from "./messages.ts";

export interface IdleFrame {
  type: "idle.fired";
  /** The session that asked to be told, and the one it was waiting for (addresses). */
  watcher: string;
  session: string;
  at: string;
}

export interface IdleOptions {
  endpoints: Endpoints;
  messaging: Messaging;
  host: string;
  clock?: (() => number) | undefined;
}

export class Idle {
  constructor(private readonly opts: IdleOptions) {}

  watch(_listener: (frame: IdleFrame) => void): () => void {
    return () => {};
  }

  /** Subscribes once; `fired` is true when the session was already idle and the notice went now. */
  subscribe(_input: { as: SessionIdentity; session: string }): { fired: boolean } {
    return { fired: false };
  }

  /** How many subscriptions are waiting. */
  pending(): number {
    return 0;
  }

  stop(): void {}
}
