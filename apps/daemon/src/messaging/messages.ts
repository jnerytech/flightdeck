/**
 * Phase 21: messages between sessions. On one host the daemon delivers straight to the session and
 * needs no app; between hosts the app carries the message from the daemon of the sender to the
 * daemon of the recipient, and until it does the message waits in the sender's outbox for 24 hours.
 * Every message is a row of `session_messages` for the conversations screen.
 */
import type { Database } from "bun:sqlite";
import type {
  MessageInfo,
  MessagingSession,
  RelayMessage,
  SendResult,
  SessionIdentity,
} from "@flightdeck/protocol";
import type { Endpoints } from "./endpoints.ts";
import type { Policy } from "./policy.ts";

export interface MessagingOptions {
  db: Database;
  /** This host's name, the first half of every address. */
  host: string;
  endpoints: Endpoints;
  clock?: (() => number) | undefined;
  /** The team a session belongs to, if any. */
  teamOf?: ((sessionId: string) => string | null) | undefined;
  /** The persona badge of a session (phase 20); the endpoint's own when absent. */
  personaOf?: ((sessionId: string) => string | null) | undefined;
  /** Days the history is kept (30 when absent). */
  retentionDays?: number | undefined;
}

/** The frames the app watches. */
export type MessagingFrame =
  | { type: "messages.updated"; message: MessageInfo }
  | { type: "messages.relay"; message: RelayMessage }
  | {
      type: "messaging.alert";
      kind: "loop";
      from: string;
      to: string;
      message: string;
      at: string;
    };

/** Sessions of another host, as the app last told this daemon. */
export interface PeerSession {
  id: string;
  name: string | null;
  persona: string | null;
  projectKey: string | null;
  teamId: string | null;
  state: MessagingSession["state"];
  kind: MessagingSession["kind"];
  receives: boolean;
  reason: string | null;
}

export class Messaging {
  constructor(private readonly opts: MessagingOptions) {}

  watch(_listener: (frame: MessagingFrame) => void): () => void {
    return () => {};
  }

  setPeers(_host: string, _sessions: PeerSession[]): void {}

  /** The sessions the asker may see, by the rules. */
  sessions(_as: SessionIdentity): MessagingSession[] {
    return [];
  }

  send(_input: { as: SessionIdentity; to: string; text: string }): SendResult {
    return { id: "", status: "refused", reason: null };
  }

  /** A message from another host, handed over by the app; idempotent by id. */
  relay(_message: RelayMessage): SendResult {
    return { id: "", status: "refused", reason: null };
  }

  /** The app tells how a relayed message ended at the recipient's daemon. */
  relayed(
    _id: string,
    _result: { status: "delivered" | "queued" | "refused"; reason?: string | null | undefined },
  ): void {}

  /** Messages waiting to cross to another host. */
  outbox(): RelayMessage[] {
    return [];
  }

  /** A Flightdeck notice to a session of this host (not counted in the limits). */
  notice(
    _to: string,
    _kind: "system" | "idle",
    _text: string,
    _teamId?: string | null,
  ): SendResult {
    return { id: "", status: "refused", reason: null };
  }

  list(_filter: {
    team?: string | undefined;
    session?: string | undefined;
    host?: string | undefined;
    status?: MessageInfo["status"] | undefined;
    days?: number | undefined;
    limit?: number | undefined;
  }): MessageInfo[] {
    return [];
  }

  getPolicy(): Policy {
    return {} as Policy;
  }

  /** Replaces the policy; `unpause` frees pairs the loop detector paused. */
  setPolicy(_raw: unknown, _unpause?: string[]): { policy: Policy; paused: string[] } {
    return { policy: {} as Policy, paused: [] };
  }

  pausedPairs(): string[] {
    return [];
  }

  /** Expires the outbox past 24 hours and drops the history past retention. */
  sweep(): void {}

  stop(): void {}
}
