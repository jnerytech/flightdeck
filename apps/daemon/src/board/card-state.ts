import type { Database } from "bun:sqlite";
import { refusalOf } from "../kernel/index.ts";
import { type BoardEvent, nextColumn } from "./columns.ts";
import type { Card } from "./types.ts";

const now = () => new Date().toISOString();

/**
 * How a card got done, as `roi/done-log.ts` records it. Declared here so the board does not reach
 * into that domain's files; board.ts's wiring passes it both ways, so the typecheck keeps the two equal.
 */
type DoneVia = "merged" | "completed" | "moved";

/** What a card's state and its watchers need of the board (issue #1523); late-bound, so it never imports `board.ts`. */
export interface CardStatePort {
  db: Database;
  card: (id: string) => Card;
  /** The ROI view's record of the first time a card is done. */
  recordDone: (id: string, via: DoneVia, at: string) => void;
  /** Phase 31: the cards a card holds up, and their wait after its change. */
  blockers: {
    blockingOf: (id: string) => string[];
    afterBlockerChange: (id: string) => void;
  };
}

/**
 * A card's column and notice as they change, and who hears of it (issue #1523): every change goes
 * out to the watchers, with the cards it holds up.
 */
export class CardState {
  private readonly watchers = new Set<(card: Card) => void>();

  constructor(private readonly port: CardStatePort) {}

  /** Gets every card after each change; returns the function that stops it. */
  watch(listener: (card: Card) => void): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  get watcherCount(): number {
    return this.watchers.size;
  }

  /** A card's notice; one that came from a refusal keeps its reason, which the app translates. */
  setNotice(id: string, notice: string, why?: unknown): void {
    this.port.db.query("UPDATE cards SET notice = ? WHERE id = ?").run(notice, id);
    this.setNoticeReason(id, why);
  }

  setNoticeReason(id: string, why: unknown): void {
    const refusal = refusalOf(why);
    if (!refusal) return;
    this.port.db
      .query("UPDATE cards SET notice_reason = ?, notice_params = ? WHERE id = ?")
      .run(refusal.reason, JSON.stringify(refusal.params ?? {}), id);
  }

  place(id: string, event: BoardEvent, via?: DoneVia): void {
    const card = this.port.card(id);
    const next = nextColumn({ column: card.column, locked: card.columnLocked }, event);
    this.port.db
      .query("UPDATE cards SET board_column = ?, column_locked = ?, updated_at = ? WHERE id = ?")
      .run(next.column, next.locked ? 1 : 0, now(), id);
    // The first time a card is done is the fact the ROI view counts delivered work by.
    if (next.column === "done" && card.column !== "done") {
      const how = via ?? (event.type === "pr" && event.state === "merged" ? "merged" : "moved");
      this.port.recordDone(id, how, now());
    }
    this.changed(id);
  }

  /** Sends the card as it is now to every watcher, and returns it. */
  changed(id: string): Card {
    const card = this.port.card(id);
    this.emit(card);
    // What a card waits for follows its blockers' columns: the cards it holds up are news too.
    for (const dependent of this.port.blockers.blockingOf(id)) {
      this.port.blockers.afterBlockerChange(dependent);
      this.emit(this.port.card(dependent));
    }
    return card;
  }

  emit(card: Card): void {
    // A variant is not on the board: what changed in it is news of the arena's card.
    const shown = card.arenaOf ? this.port.card(card.arenaOf) : card;
    for (const watcher of this.watchers) {
      try {
        watcher(shown);
      } catch {
        // A broken watcher must not break the board.
      }
    }
  }
}
