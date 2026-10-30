/**
 * Phase 21: what the messaging layer needs of the sessions of this host. The real adapter reads
 * the session manager, the cards and the terminal sessions of the central hub; tests hand in a
 * fake. A session is addressed by its id: the managed id, or the Claude session id of a terminal.
 */
import type { MessagingSession, SessionLine } from "@flightdeck/protocol";

export interface EndpointInfo {
  id: string;
  /** `card` is a managed session of a card; `plain` is a terminal claude with no channel. */
  kind: MessagingSession["kind"];
  name: string | null;
  persona: string | null;
  projectKey: string | null;
  state: MessagingSession["state"];
  /** Whether it takes messages; `reason` says why not. */
  controllable: boolean;
  reason: string | null;
}

export interface ReadMessage {
  role: "user" | "assistant";
  text: string;
}

export interface Endpoints {
  list(): EndpointInfo[];
  /** The session a terminal launch (`FLIGHTDECK_LAUNCH_ID`) is, if it started one. */
  byLaunch(launchId: string): string | null;
  /**
   * Hands the text to the session. `delivered`: it is in the session; `queued`: the session is in
   * a turn and takes it when the turn ends. Throws a `FlightdeckError` when it cannot take it.
   */
  send(id: string, text: string): "delivered" | "queued";
  /** Whether third-party content reached the session (phase 13). */
  untrusted(id: string): boolean;
  /** Suspends the automatic approval in the session. */
  suspend(id: string, reason: string): void;
  /** A turn ended (managed) or the terminal session stopped. */
  onIdle(listener: (id: string) => void): () => void;
  /** A user message reached a managed session (a queued message is delivered then). */
  onUserMessage(listener: (id: string, text: string) => void): () => void;
  /** A session changed state (a held message goes when a terminal leaves `waiting`). */
  onState(listener: (id: string, state: MessagingSession["state"]) => void): () => void;
  /** The summary and the last messages of the transcript, or null for a session that is not known. */
  read(id: string, last: number): { summary: SessionLine | null; messages: ReadMessage[] } | null;
}
