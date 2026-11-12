import {
  EPHEMERAL_EVENTS,
  type EventEnvelope,
  type SessionEventOf,
  type SessionSubscribeResult,
} from "@flightdeck/protocol";
import { sessionKey } from "./session-key.ts";
import {
  applyEnvelope,
  emptySession,
  endStreaming,
  markGap,
  type SessionState,
} from "./session-state.ts";

/** What the stream reads and asks through the app's store. */
export interface SessionStreamCore {
  /** The conversations the app holds, by session key. */
  sessions(): Record<string, SessionState>;
  /** Replaces the conversations, as one change. */
  setSessions(sessions: Record<string, SessionState>): void;
  /** A host's session summary: it feeds the sidebar, not a conversation. */
  summary(hostId: string, event: SessionEventOf<"session.summary">): void;
  /** Asks a host to replay a session from the last event the app has. */
  resync(hostId: string, sessionId: string): void;
}

/**
 * What a host's session events do to the conversations the app holds (#1596: a slice of the
 * store): each event is applied in order, a lost one is asked for again (once per hole), and a hole
 * the host cannot fill is marked in the conversation instead of hidden.
 */
export class SessionStreamSlice {
  /** Sessions whose lost frame was asked for again (cleared when the next frame fits). */
  private readonly resyncing = new Map<string, "asked" | "answered">();

  constructor(private readonly core: SessionStreamCore) {}

  onEvent(hostId: string, envelope: EventEnvelope): void {
    if (envelope.event.type === "session.summary") {
      this.core.summary(hostId, envelope.event);
      return;
    }
    const key = sessionKey(hostId, envelope.sessionId);
    const known = this.core.sessions()[key] ?? emptySession();
    const current = this.afterLostFrames(hostId, key, envelope, known);
    if (!current) return;
    const session = applyEnvelope(current, envelope);
    this.core.setSessions({ ...this.core.sessions(), [key]: session });
  }

  /**
   * A session asked from the start that had events (`lastSeq` > 0) but replays none lost them
   * to the host's retention: the view says so instead of showing an empty conversation.
   */
  onSubscribed(hostId: string, sessionId: string, result: SessionSubscribeResult): void {
    const key = sessionKey(hostId, sessionId);
    // What the host has after our last seq is on its way (it follows the answer): a hole that is
    // still there when it arrives is one the host cannot fill.
    if (this.resyncing.get(key) === "asked") this.resyncing.set(key, "answered");
    const current = this.core.sessions()[key] ?? emptySession();
    if (result.replayed > 0 || result.session.lastSeq === 0 || current.lastSeq > 0) return;
    const pruned = {
      ...current,
      pruned: true,
      status: result.session.status,
      cwd: result.session.cwd,
    };
    this.core.setSessions({ ...this.core.sessions(), [key]: pruned });
  }

  /** Partial text from before a drop will never be completed by a delta; drop it. */
  dropPartialText(hostId: string): void {
    const sessions = { ...this.core.sessions() };
    for (const key of Object.keys(sessions)) {
      if (key.startsWith(`${hostId}/`)) sessions[key] = endStreaming(sessions[key] as SessionState);
    }
    this.core.setSessions(sessions);
  }

  /**
   * The state an event applies on: `known`, or `known` marked with a gap when the host could not
   * replay what was lost; null when the frame must wait for that replay.
   */
  private afterLostFrames(
    hostId: string,
    key: string,
    envelope: EventEnvelope,
    known: SessionState,
  ): SessionState | null {
    if (EPHEMERAL_EVENTS.has(envelope.event.type) || known.lastSeq <= 0) return known;
    if (envelope.seq === known.lastSeq + 1) this.resyncing.delete(key);
    if (envelope.seq <= known.lastSeq + 1) return known;
    // A frame was lost on the way: this one is not applied (it would leave a hole). The
    // daemon replays from the last seq we have, once per hole.
    const asked = this.resyncing.get(key);
    if (asked === undefined) {
      this.resyncing.set(key, "asked");
      this.core.resync(hostId, envelope.sessionId);
      return null;
    }
    if (asked === "asked") return null;
    // The host answered and the hole is still there (its retention cut it): go on from
    // here and say so in the conversation.
    this.resyncing.delete(key);
    return markGap(known);
  }
}
