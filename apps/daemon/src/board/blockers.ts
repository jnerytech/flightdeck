import type { Database } from "bun:sqlite";
import type { UnblockWhen } from "@flightdeck/protocol";
import { FlightdeckError, parseJsonWith } from "../kernel/index.ts";
import { cyclePath, MAX_BLOCKERS } from "./deps.ts";
import { AutoStart } from "./row-json.ts";
import type { BoardColumn, Card, CardRow, PrState } from "./types.ts";

const now = () => new Date().toISOString();

/** What a card's blockers need of the board (issue #1523); late-bound, so it never imports `board.ts`. */
export interface BlockersPort {
  db: Database;
  card: (id: string) => Card;
  changed: (id: string) => Card;
  startCard: (id: string, options: { workflow?: string }) => Promise<Card>;
  stopped: () => boolean;
  setNoticeReason: (id: string, why: unknown) => void;
}

/**
 * Issue #1523: the cards a card waits for (phase 31): the stored links, the gate before a start,
 * the end of a wait and its auto-start, and the checks a new set of blockers must pass.
 */
export class Blockers {
  constructor(private readonly port: BlockersPort) {}

  /** The cards that must be done before `id`, in the order the person set them. */
  blockersOf(id: string): string[] {
    return this.port.db
      .query<{ blocker_id: string }, [string]>(
        "SELECT blocker_id FROM card_blockers WHERE card_id = ? ORDER BY position",
      )
      .all(id)
      .map((row) => row.blocker_id);
  }

  /** The blockers of `id` that are not satisfied: not in Done, or, with merged, not merged. */
  unsatisfied(id: string, when: UnblockWhen): string[] {
    return this.blockersOf(id).filter((blocker) => {
      const row = this.port.db
        .query<{ board_column: BoardColumn; pr_state: PrState | null }, [string]>(
          "SELECT board_column, pr_state FROM cards WHERE id = ?",
        )
        .get(blocker);
      if (row?.board_column !== "done") return true;
      return when === "merged" && row?.pr_state !== "merged";
    });
  }

  /** The one gate of phase 31: a card with blockers not satisfied does not start. */
  refuseIfBlocked(card: Card): void {
    if (card.waitingOn.length === 0) return;
    const blockers = card.waitingOn.map((id) => this.port.card(id).title).join(", ");
    throw new FlightdeckError(
      "invalid_state",
      `card ${card.id} is blocked by: ${blockers}`,
      "card_blocked",
      { blockers },
    );
  }

  /** Phase 31: the person dismisses the "unblocked" mark. */
  dismissUnblocked(id: string): Card {
    this.port.card(id);
    this.port.db.query("UPDATE cards SET unblocked_at = NULL WHERE id = ?").run(id);
    return this.port.changed(id);
  }

  /**
   * What the end of a card's wait does, once: the last blocker was satisfied (or went away). With
   * auto-start the card starts like any other start, through the queue; without it the card gets
   * the mark. `waiting` is what tells the end of a wait from a card that was never blocked.
   */
  afterBlockerChange(id: string): void {
    const { db } = this.port;
    const row = db.query<CardRow, [string]>("SELECT * FROM cards WHERE id = ?").get(id);
    if (!row) return;
    const hasRun = db.query("SELECT 1 FROM card_runs WHERE card_id = ?").get(id) !== null;
    const waiting = !hasRun && this.unsatisfied(id, row.unblock_when).length > 0;
    if (waiting) {
      if (row.waiting === 0) db.query("UPDATE cards SET waiting = 1 WHERE id = ?").run(id);
      return;
    }
    if (row.waiting === 0) return;
    db.query("UPDATE cards SET waiting = 0 WHERE id = ?").run(id);
    if (hasRun) return;
    const auto = row.auto_start ? parseJsonWith(AutoStart, row.auto_start) : null;
    if (!auto) {
      db.query("UPDATE cards SET unblocked_at = ? WHERE id = ?").run(now(), id);
      return;
    }
    void this.port
      .startCard(id, auto.workflow ? { workflow: auto.workflow } : {})
      .catch((error: unknown) => {
        if (this.port.stopped()) return;
        const why = error instanceof Error ? error.message : String(error);
        db.query("UPDATE cards SET notice = ?, unblocked_at = ? WHERE id = ?").run(
          `Auto-start failed: ${why}`,
          now(),
          id,
        );
        this.port.setNoticeReason(id, error);
        this.port.changed(id);
      });
  }

  /** A change the person made to the links: the wait is noted, and nothing starts or is marked. */
  noteWaiting(id: string): void {
    const row = this.port.card(id);
    this.port.db
      .query("UPDATE cards SET waiting = ? WHERE id = ?")
      .run(row.waitingOn.length > 0 ? 1 : 0, id);
  }

  /** The cards `id` holds up. */
  blockingOf(id: string): string[] {
    return this.port.db
      .query<{ card_id: string }, [string]>(
        "SELECT card_id FROM card_blockers WHERE blocker_id = ? ORDER BY rowid",
      )
      .all(id)
      .map((row) => row.card_id);
  }

  /**
   * Refuses a set of blockers before anything is written: a card that is not there, one of
   * another project, too many, or a cycle (`id` is `null` for a card not made yet, which cannot
   * be in one).
   */
  checkBlockers(id: string | null, projectId: string, blockers: readonly string[]): void {
    if (blockers.length > MAX_BLOCKERS) {
      throw new FlightdeckError(
        "invalid_state",
        `a card has at most ${MAX_BLOCKERS} blockers`,
        "blocker_limit",
        { max: MAX_BLOCKERS },
      );
    }
    for (const blocker of blockers) {
      if (this.port.card(blocker).projectId !== projectId) {
        throw new FlightdeckError(
          "invalid_state",
          `card ${blocker} is in another project`,
          "blocker_other_project",
        );
      }
    }
    if (id === null) return;
    // The stored links, except the ones this card is about to replace.
    const stored = (of: string) => (of === id ? [] : this.blockersOf(of));
    for (const blocker of blockers) {
      const path = cyclePath(id, blocker, stored);
      if (path) {
        const cycle = path.map((card) => this.port.card(card).title).join(" → ");
        throw new FlightdeckError("invalid_state", `a cycle: ${cycle}`, "blocker_cycle", {
          cycle,
        });
      }
    }
  }

  /** Replaces the blockers of `id` with `blockers`, in that order. */
  storeBlockers(id: string, blockers: readonly string[]): void {
    const { db } = this.port;
    db.transaction(() => {
      db.query("DELETE FROM card_blockers WHERE card_id = ?").run(id);
      const insert = db.query(
        "INSERT INTO card_blockers (card_id, blocker_id, position) VALUES (?, ?, ?)",
      );
      for (const [position, blocker] of blockers.entries()) insert.run(id, blocker, position);
    })();
  }
}
