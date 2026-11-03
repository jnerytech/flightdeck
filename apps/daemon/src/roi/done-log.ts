/**
 * Phase 36: the done-log. A card entering Concluído writes one row, once: when it was done, how, the
 * PR and the rework it had. The roll-up counts what was delivered from these rows. Facts only: no
 * rate, no price, no value.
 */
import type { Database } from "bun:sqlite";

export type DoneVia = "merged" | "completed" | "moved";

export interface DoneRow {
  cardId: string;
  projectId: string;
  /** When the card was first done (ISO). */
  doneAt: string;
  via: DoneVia;
  prUrl: string | null;
  /** When the card was created (ISO): the split between planned and unplanned work needs it. */
  cardCreatedAt: string;
  fixRounds: number;
  fixCostUsd: number;
  /** The date was taken from the card's last update when the log began. */
  approx: boolean;
}

interface Row {
  card_id: string;
  project_id: string;
  done_at: string;
  via: DoneVia;
  pr_url: string | null;
  card_created_at: string;
  fix_rounds: number;
  fix_cost_usd: number;
  approx: number;
}

/** The first time a card is done writes its row; a later return to Concluído adds nothing. */
export function recordDone(db: Database, cardId: string, via: DoneVia, at: string): void {
  db.query(
    `INSERT OR IGNORE INTO card_done
       (card_id, project_id, done_at, via, pr_url, card_created_at, fix_rounds, fix_cost_usd)
     SELECT c.id, c.project_id, ?, ?, c.pr_url, c.created_at,
            (SELECT COUNT(*) FROM pr_watch_rounds WHERE card_id = c.id),
            (SELECT COALESCE(SUM(cost_usd), 0) FROM pr_watch_rounds WHERE card_id = c.id)
     FROM cards c WHERE c.id = ?`,
  ).run(at, via, cardId);
}

export function readDone(db: Database, cardId: string): DoneRow | null {
  const row = db.query<Row, [string]>("SELECT * FROM card_done WHERE card_id = ?").get(cardId);
  return row
    ? {
        cardId: row.card_id,
        projectId: row.project_id,
        doneAt: row.done_at,
        via: row.via,
        prUrl: row.pr_url,
        cardCreatedAt: row.card_created_at,
        fixRounds: row.fix_rounds,
        fixCostUsd: row.fix_cost_usd,
        approx: row.approx === 1,
      }
    : null;
}

/** A discarded card has no row. */
export function forgetDone(db: Database, cardId: string): void {
  db.query("DELETE FROM card_done WHERE card_id = ?").run(cardId);
}
