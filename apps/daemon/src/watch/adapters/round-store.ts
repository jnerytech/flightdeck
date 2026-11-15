import type { Database } from "bun:sqlite";
import { type FixRound, type RoundRow, toRound } from "../domain/fix-round.ts";

/** What a round cost, kept with its end. */
export interface Spent {
  sessionId?: string | null;
  costUsd?: number;
  turns?: number;
}

/**
 * The SQLite side of the fix rounds (#1589): the `pr_watch_rounds` rows. The fixer decides when a
 * round starts, ends or is held; this only writes what it decided. Every time is an ISO string
 * the caller read from its own clock.
 */
export class RoundStore {
  constructor(private readonly db: Database) {}

  /** A round the daemon left running when it stopped will never end by itself. */
  failRunning(at: string): void {
    this.db
      .query(
        `UPDATE pr_watch_rounds SET status = 'failed', summary = 'the daemon stopped during the round',
           ended_at = ? WHERE status = 'running'`,
      )
      .run(at);
  }

  /** The card's newest round as stored, or null. */
  last(cardId: string): RoundRow | null {
    return this.db
      .query<RoundRow, [string]>(
        "SELECT * FROM pr_watch_rounds WHERE card_id = ? ORDER BY n DESC LIMIT 1",
      )
      .get(cardId);
  }

  all(cardId: string): FixRound[] {
    return this.db
      .query<RoundRow, [string]>("SELECT * FROM pr_watch_rounds WHERE card_id = ? ORDER BY n")
      .all(cardId)
      .map(toRound);
  }

  /** What the project's rounds cost since `since` (an ISO time). */
  costSince(projectId: string, since: string): number {
    return (
      this.db
        .query<{ cost: number | null }, [string, string]>(
          `SELECT SUM(r.cost_usd) AS cost FROM pr_watch_rounds r JOIN cards c ON c.id = r.card_id
           WHERE c.project_id = ? AND r.started_at > ?`,
        )
        .get(projectId, since)?.cost ?? 0
    );
  }

  /** A held round under a new one goes with it: its commits are measured again with the new one's. */
  supersedeHeld(cardId: string, summary: string, at: string): void {
    this.db
      .query(
        `UPDATE pr_watch_rounds SET status = 'stopped', summary = ?, ended_at = ?
       WHERE card_id = ? AND status = 'held'`,
      )
      .run(summary, at, cardId);
  }

  start(round: { id: string; cardId: string; n: number; trigger: string; at: string }): void {
    this.db
      .query(
        `INSERT INTO pr_watch_rounds (id, card_id, n, status, trigger, started_at)
       VALUES (?, ?, ?, 'running', ?, ?)`,
      )
      .run(round.id, round.cardId, round.n, round.trigger, round.at);
  }

  /** The round ends; a session id already stored stays when none is given. */
  end(id: string, status: FixRound["status"], summary: string, spent: Spent, at: string): void {
    this.db
      .query(
        `UPDATE pr_watch_rounds SET status = ?, summary = ?, session_id = COALESCE(?, session_id),
           cost_usd = ?, turns = ?, ended_at = ? WHERE id = ?`,
      )
      .run(status, summary, spent.sessionId ?? null, spent.costUsd ?? 0, spent.turns ?? 0, at, id);
  }

  /** The person pushed or dropped a held round: only its status, summary and end change. */
  settle(id: string, status: string, summary: string | null, at: string): void {
    this.db
      .query("UPDATE pr_watch_rounds SET status = ?, summary = ?, ended_at = ? WHERE id = ?")
      .run(status, summary, at, id);
  }

  /** Where the round started, so a drop takes back its commits only. */
  setBase(id: string, sha: string): void {
    this.db.query("UPDATE pr_watch_rounds SET base_sha = ? WHERE id = ?").run(sha, id);
  }

  /** The commit a held round waits at and the drift that held it. */
  setHeld(id: string, sha: string | null, drift: string | null): void {
    this.db
      .query("UPDATE pr_watch_rounds SET held_sha = ?, drift = ? WHERE id = ?")
      .run(sha, drift, id);
  }
}
