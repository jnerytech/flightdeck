import type { Database } from "bun:sqlite";
import type { PersonaRef, SessionEvent, SessionStatus } from "@flightdeck/protocol";
import type { SessionManager } from "../sessions/session-manager.ts";
import type { CheckLoopEngine } from "./check-loop-engine.ts";
import type { BoardEvent } from "./columns.ts";
import type { Card } from "./types.ts";

/** How a fix run (phase 22) ended: its first turn's result. */
export interface FixResult {
  sessionId: string | null;
  costUsd: number;
  isError: boolean;
  error: string | null;
}

/** A run stops holding its slot when its session goes idle, fails or ends. */
export const FREES_SLOT: ReadonlySet<SessionStatus> = new Set(["idle", "error", "ended"]);

/** What following a card's session reaches of the board (issue #1523). */
export interface SessionFollowPort {
  db: Database;
  manager: Pick<SessionManager, "subscribe">;
  /** The check loop, or null when the host runs none. */
  loop(): CheckLoopEngine | null;
  place(cardId: string, event: BoardEvent): void;
  /** Frees the card's run slot. */
  release(cardId: string): void;
  refreshConflicts(cardId: string): Promise<void>;
  startCard(
    id: string,
    options: { fix: { prompt: string }; persona?: PersonaRef },
  ): Promise<unknown>;
  card(id: string): Card;
}

/**
 * Issue #1523 (the board split): the sessions of the cards' active runs. Their events move the
 * cards, free run slots, feed the check loop and settle the fix runs.
 */
export class SessionFollow {
  /** Card id → stops following the session of its active run. */
  private readonly follows = new Map<string, () => void>();
  /** Phase 22: the fix runs waiting for their first turn to end, by card. */
  private readonly fixes = new Map<string, (result: FixResult) => void>();

  constructor(private readonly port: SessionFollowPort) {}

  /** Stops following the card's session. */
  unfollow(cardId: string): void {
    this.follows.get(cardId)?.();
    this.follows.delete(cardId);
  }

  /** Stops following every session (the board stops). */
  unfollowAll(): void {
    for (const unfollow of this.follows.values()) unfollow();
    this.follows.clear();
  }

  /**
   * Phase 22: a run with a prompt of its own (it waits in the same queue, quota and budgets as
   * any run), in a session nobody sits in; settled when its first turn ends.
   */
  async fixCard(id: string, opts: { prompt: string; persona?: PersonaRef }): Promise<FixResult> {
    const settled = new Promise<FixResult>((resolve) => this.fixes.set(id, resolve));
    try {
      await this.port.startCard(id, {
        fix: { prompt: opts.prompt },
        ...(opts.persona ? { persona: opts.persona } : {}),
      });
    } catch (error) {
      this.fixes.delete(id);
      throw error;
    }
    return settled;
  }

  /** The fix run of a card ended (its first turn, an error or a stop): its caller hears how. */
  settleFix(id: string, result: Partial<FixResult>): void {
    const done = this.fixes.get(id);
    if (!done) return;
    this.fixes.delete(id);
    done({
      sessionId: this.port.card(id).sessionId,
      costUsd: 0,
      isError: false,
      error: null,
      ...result,
    });
  }

  /** Session events of the card's active run move the card (replay first, then live). */
  follow(cardId: string, sessionId: string, sinceSeq: number): void {
    this.follows.get(cardId)?.();
    const sub = this.port.manager.subscribe(sessionId, sinceSeq, (envelope) =>
      this.onSessionEvent(cardId, envelope.event, { live: true, seq: envelope.seq }),
    );
    this.follows.set(cardId, sub.unsubscribe);
    // Replayed events are history: they move the card, but the check loop never acts on them.
    for (const envelope of sub.replay) {
      this.onSessionEvent(cardId, envelope.event, { live: false, seq: envelope.seq });
    }
  }

  /** One event of a card's session: `live` past the replay, `seq` its place in the session. */
  onSessionEvent(cardId: string, event: SessionEvent, at: { live: boolean; seq: number }): void {
    const loop = at.live ? this.port.loop() : null;
    switch (event.type) {
      case "message.user":
        // Issue #1361: whatever path wrote into the session (a review comment, a message between
        // sessions, a persona hand-off), it is outside input unless it is the loop's own round.
        loop?.onUserMessage(cardId, event.text);
        break;
      case "session.status":
        this.onStatus(cardId, event.status, loop);
        break;
      case "turn.result":
        this.onTurnResult(cardId, event, at.seq, loop);
        break;
      case "session.error":
        this.settleFix(cardId, { isError: true, error: event.message });
        break;
    }
  }

  /** The session's status moves the card; one that went idle, failed or ended frees its slot. */
  private onStatus(cardId: string, status: SessionStatus, loop: CheckLoopEngine | null): void {
    this.port.place(cardId, { type: "session", status });
    if (FREES_SLOT.has(status)) this.releaseAfter(cardId, status, loop);
    else loop?.onBusy(cardId);
  }

  private onTurnResult(
    cardId: string,
    event: Extract<SessionEvent, { type: "turn.result" }>,
    seq: number,
    loop: CheckLoopEngine | null,
  ): void {
    // Issue #1361: a live turn after the card's mark goes to the loop, which may keep the card
    // where it is while its checks run (`hold`); otherwise it moves as it always did.
    const decision =
      loop && this.newTurn(cardId, seq)
        ? loop.onTurnResult(cardId, { isError: event.isError, interrupted: false })
        : "place";
    if (decision === "place") this.port.place(cardId, { type: "turn", isError: event.isError });
    void this.port.refreshConflicts(cardId).catch(() => {});
    this.settleFix(cardId, {
      costUsd: event.costUsd ?? 0,
      isError: event.isError,
      error: event.isError ? event.subtype : null,
    });
  }

  /** The slot a session that went idle, failed or ended frees, unless the check loop holds it. */
  private releaseAfter(cardId: string, status: SessionStatus, loop: CheckLoopEngine | null): void {
    let free: boolean;
    if (!loop) free = true;
    else if (status === "idle") free = loop.onIdle(cardId) === "release";
    else free = !loop.onSessionGone(cardId);
    if (free) this.port.release(cardId);
  }

  /**
   * Issue #1361: whether a turn result is new for the card's check loop (after its mark), moving
   * the mark to it; a card with the switch off has no mark to keep.
   */
  private newTurn(cardId: string, seq: number): boolean {
    const row = this.port.db
      .query<{ loop_on: number; mark: number | null }, [string]>(
        "SELECT check_loop AS loop_on, check_loop_turn_seq AS mark FROM cards WHERE id = ?",
      )
      .get(cardId);
    if (row?.loop_on !== 1) return true;
    if (row.mark !== null && seq <= row.mark) return false;
    this.port.db.query("UPDATE cards SET check_loop_turn_seq = ? WHERE id = ?").run(seq, cardId);
    return true;
  }

  /** Issue #1361: the person wrote into a card's session, or answered it: the loop steps aside. */
  personTurnOfSession(sessionId: string): void {
    const run = this.port.db
      .query<{ card_id: string }, [string]>(
        "SELECT card_id FROM card_runs WHERE session_id = ? ORDER BY rowid DESC LIMIT 1",
      )
      .get(sessionId);
    if (run) this.port.loop()?.onPersonTurn(run.card_id);
  }
}
