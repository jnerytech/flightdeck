import type { Database } from "bun:sqlite";
import { inSequence } from "@flightdeck/protocol";
import { ConflictRadar, radarGit } from "./conflict-radar.ts";
import { type Rev, refArg } from "./ref-arg.ts";
import type { Card, MayConflict, Project } from "./types.ts";

/** What the radar's feed needs of the board (issue #1523); late-bound, so it never imports `board.ts`. */
export interface RadarFeedPort {
  db: Database;
  card: (id: string) => Card;
  project: (id: string) => Project;
  changed: (id: string) => unknown;
  stopped: () => boolean;
}

/**
 * Issue #1523: what feeds the conflict radar (issue #1405): one read of a card at a time, the
 * base it is read against, the cards that drop out of it, and the overlaps a card shows.
 */
export class RadarFeed {
  /** Issue #1405: which cards of a project edit the same files. */
  private readonly radar = new ConflictRadar(radarGit());
  /** The radar reads of the cards in flight, and the ones asked again meanwhile. */
  private readonly reads = new Map<string, { again: boolean; done: Promise<void> }>();

  constructor(private readonly port: RadarFeedPort) {}

  /** Issue #1405: reads what the card changed and tells the cards that now share files with it. */
  refresh(id: string): Promise<void> {
    // One read of a card at a time; a turn that ends meanwhile asks for one more, not for another.
    const running = this.reads.get(id);
    if (running) {
      running.again = true;
      return running.done;
    }
    const read = { again: false, done: Promise.resolve() };
    read.done = (async () => {
      try {
        do {
          read.again = false;
          await this.read(id);
        } while (read.again && !this.port.stopped());
      } finally {
        this.reads.delete(id);
      }
    })();
    this.reads.set(id, read);
    return read.done;
  }

  /** The base branch of a card the radar should watch, or `null`: no worktree, finished, or no base. */
  private base(id: string): Rev | null {
    if (!this.exists(id)) return null;
    const card = this.port.card(id);
    if (card.worktreePath === null || card.column === "done") return null;
    if (card.prState === "merged" || card.prState === "closed") return null;
    try {
      return refArg(this.port.project(card.projectId).baseBranch);
    } catch {
      return null;
    }
  }

  private async read(id: string): Promise<void> {
    if (this.port.stopped()) return;
    const base = this.base(id);
    if (base === null) return this.drop(id);
    const card = this.port.card(id);
    const affected = await this.radar.update(
      {
        id,
        projectId: card.projectId,
        worktree: card.worktreePath as string,
        base,
        group: card.arenaOf ?? id,
      },
      () => !this.port.stopped() && this.base(id) !== null,
    );
    for (const other of affected) if (this.exists(other)) this.port.changed(other);
  }

  /** The radar starts empty: read the cards that already have a worktree, one at a time. */
  async refreshAll(): Promise<void> {
    const ids = this.port.db
      .query<{ id: string }, []>("SELECT id FROM cards WHERE worktree_path IS NOT NULL")
      .all()
      .map(({ id }) => id);
    await inSequence(ids, (id) => this.refresh(id));
  }

  /** The card no longer takes part in the radar; the cards that were flagged with it hear of it. */
  drop(id: string): void {
    for (const other of this.radar.remove(id)) {
      if (this.exists(other)) this.port.changed(other);
    }
  }

  private exists(id: string): boolean {
    return this.port.db.query("SELECT 1 FROM cards WHERE id = ?").get(id) !== null;
  }

  /** The card's overlaps for its fields: nothing at all when it shares no file with another card. */
  mayConflictOf(id: string): { mayConflict?: MayConflict[] } {
    const overlaps = this.radar.overlaps(id);
    if (overlaps.length === 0) return {};
    const titleOf = this.port.db.query<{ title: string }, [string]>(
      "SELECT title FROM cards WHERE id = ?",
    );
    return {
      mayConflict: overlaps.flatMap(({ cardId, files }) => {
        const title = titleOf.get(cardId)?.title;
        return title === undefined ? [] : [{ cardId, title, files }];
      }),
    };
  }
}
