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

/** The first time a card is done writes its row; a later return to Concluído adds nothing. */
export function recordDone(_db: Database, _cardId: string, _via: DoneVia, _at: string): void {}

export function readDone(_db: Database, _cardId: string): DoneRow | null {
  return null;
}

/** A discarded card has no row. */
export function forgetDone(_db: Database, _cardId: string): void {}
