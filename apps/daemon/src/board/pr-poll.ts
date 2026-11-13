import type { Database } from "bun:sqlite";
import { inSequence } from "@flightdeck/protocol";
import type { BoardEvent } from "./domain/columns.ts";
import { prProvider } from "./pr.ts";
import type { BoardOptions, Card, Project } from "./types.ts";

/** How often cards with an open PR ask the provider for its state and checks. */
export const DEFAULT_PR_POLL_MS = 60_000;

/** What the PR polling needs of the board (issue #1523); late-bound, so it never imports `board.ts`. */
export interface PrPollPort {
  db: Database;
  opts: Pick<BoardOptions, "prProvider" | "prPollIntervalMs">;
  card: (id: string) => Card;
  project: (id: string) => Project;
  changed: (id: string) => unknown;
  place: (id: string, event: BoardEvent) => void;
  setNotice: (id: string, notice: string, why?: unknown) => void;
  finish: (id: string) => Promise<void>;
  stopped: () => boolean;
  /** The comments of an open PR come in the same round (`CardPrFlow.fetchComments`). */
  fetchComments: (id: string) => Promise<unknown>;
  /** The notice of a done card whose worktree kept changes (`launch.ts`): such a card waits for the person. */
  pendingNotice: string;
}

/**
 * Issue #1523: the PR polling of the cards with an open PR. It owns the timer, the rounds, the
 * reads in flight and the listeners of a round and of checks that turn to failing.
 */
export class PrPoll {
  /** Runs while a PR is open or a merge waits to be finished; see `arm`. */
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly roundListeners = new Set<() => void>();
  private polling = false;
  /** The last PR poll round, finished or not (a failed one counts as finished): see `idle`. */
  private lastRound: Promise<void> = Promise.resolve();
  /** The reads in flight, by card: a poll and a merge asking at once share one answer (and one `place`). */
  private readonly reads = new Map<string, Promise<void>>();
  private readonly checkWatchers = new Set<(cardId: string, failed: string[]) => void>();

  constructor(private readonly port: PrPollPort) {}

  /** Calls `listener` after every round of the PR polling. */
  onPrRound(listener: () => void): () => void {
    this.roundListeners.add(listener);
    return () => this.roundListeners.delete(listener);
  }

  /**
   * Phase 13: told when a card's PR checks turn to failing (not on every poll that finds them
   * failing), with the names that failed; returns the function that stops it.
   */
  onChecksFailing(listener: (cardId: string, failed: string[]) => void): () => void {
    this.checkWatchers.add(listener);
    return () => this.checkWatchers.delete(listener);
  }

  /**
   * The PR polling runs while some card has an open PR, or a merged card waits for its worktree
   * to be removed; with none it owns no timer, and a PR that is opened starts it.
   */
  arm(): void {
    const wanted =
      !this.port.stopped() &&
      this.port.db
        .query(
          `SELECT 1 FROM cards WHERE pr_state = 'open'
           OR (pr_state = 'merged' AND board_column = 'done' AND worktree_path IS NOT NULL
               AND notice IS NOT NULL AND notice <> ?) LIMIT 1`,
        )
        .get(this.port.pendingNotice) !== null;
    if (wanted && this.timer === null) {
      this.timer = setInterval(() => void this.pollPrs(), this.intervalMs);
    } else if (!wanted && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get intervalMs(): number {
    return this.port.opts.prPollIntervalMs ?? DEFAULT_PR_POLL_MS;
  }

  /** Asks the provider about every card with an open PR; one round at a time. */
  async pollPrs(): Promise<void> {
    if (this.polling) return;
    const round = this.pollRound();
    this.lastRound = round.catch(() => {});
    await round;
  }

  private async pollRound(): Promise<void> {
    const { db } = this.port;
    this.polling = true;
    try {
      const open = db
        .query<{ id: string }, []>("SELECT id FROM cards WHERE pr_state = 'open'")
        .all();
      const failed = (id: string) => (error: unknown) => {
        // After stop() the failure is the shutdown's (a closed database): nothing to record.
        if (this.port.stopped()) return;
        this.port.setNotice(id, error instanceof Error ? error.message : String(error), error);
        // The card may have been discarded while the provider was answering.
        if (db.query("SELECT 1 FROM cards WHERE id = ?").get(id)) this.port.changed(id);
      };
      // An empty list is not awaited: a round with nothing to ask ends in the tick it starts.
      if (open.length > 0) {
        await inSequence(open, async ({ id }) => {
          await this.pollPr(id).catch(failed(id));
        });
      }
      if (this.port.stopped()) return;
      // Merged, but the worktree removal failed (a busy folder on Windows; its error is the
      // notice): finish again, without asking the provider. Pending changes wait for the user,
      // as in completeCard, and a card started again (notice cleared) is left alone.
      const unfinished = db
        .query<{ id: string }, [string]>(
          `SELECT id FROM cards WHERE pr_state = 'merged' AND board_column = 'done'
           AND worktree_path IS NOT NULL AND notice IS NOT NULL AND notice <> ?`,
        )
        .all(this.port.pendingNotice);
      if (unfinished.length > 0) {
        await inSequence(unfinished, async ({ id }) => {
          await this.port.finish(id).catch(failed(id));
        });
      }
      for (const listener of this.roundListeners) listener();
    } finally {
      this.polling = false;
      this.arm();
    }
  }

  /** The read of a card's PR in flight, if any. */
  inFlight(id: string): Promise<void> | undefined {
    return this.reads.get(id);
  }

  pollPr(id: string): Promise<void> {
    const running = this.reads.get(id);
    if (running) return running;
    const read = this.readPr(id).finally(() => this.reads.delete(id));
    this.reads.set(id, read);
    return read;
  }

  private async readPr(id: string): Promise<void> {
    const { db } = this.port;
    const card = this.port.card(id);
    const project = this.port.project(card.projectId);
    const provider = (this.port.opts.prProvider ?? prProvider)(project.prProvider);
    if (!provider || !card.prUrl) return;
    // From the main repository: a cwd inside the worktree would lock it while it is removed.
    const cwd = project.path;
    const { state, checks, failed, mergeable, review, openedAt } = await provider.status({
      cwd,
      url: card.prUrl,
    });
    if (this.port.stopped()) return;
    // A provider that says nothing of the details leaves what the card has.
    db.query(
      `UPDATE cards SET pr_state = ?, checks_state = ?, notice = NULL,
           pr_mergeable = COALESCE(?, pr_mergeable), pr_review = COALESCE(?, pr_review),
           pr_opened_at = COALESCE(?, pr_opened_at) WHERE id = ?`,
    ).run(state, checks, mergeable ?? null, review ?? null, openedAt ?? null, id);
    this.port.changed(id);
    if (checks === "failing" && card.checksState !== "failing") {
      for (const listener of this.checkWatchers) listener(id, failed ?? []);
    }
    if (state !== card.prState) this.port.place(id, { type: "pr", state });
    // The comments come in the same round; a failure keeps the last ones, quietly.
    if (state === "open") await this.port.fetchComments(id).catch(() => {});
    if (state === "merged") await this.port.finish(id);
  }

  /** Resolves when no PR poll round is running (stop() lets the one in flight finish). */
  idle(): Promise<void> {
    return this.lastRound;
  }

  /** Stops the timer (the board's `stop()`). */
  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
