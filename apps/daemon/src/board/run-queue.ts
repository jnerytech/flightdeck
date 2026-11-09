import type { Database } from "bun:sqlite";
import { ulid } from "../ulid.ts";
import type { BoardOptions, Card, Project, RunRow } from "./types.ts";

const now = () => new Date().toISOString();

/** What the run queue reaches of the board (issue #1523). */
export interface RunQueuePort {
  db: Database;
  opts: Pick<
    BoardOptions,
    "maxParallelRuns" | "quota" | "memory" | "pause" | "budgets" | "projectKeys"
  >;
  project(id: string): Project;
  /** The card changed: the board announces it. */
  changed(id: string): unknown;
  /** Opens the session of a run that left the queue. */
  launch(cardId: string, runId: string): Promise<void>;
  failRun(cardId: string, runId: string, notice: string, why?: unknown): void;
  /** Whether the board has stopped (its database may be closed). */
  stopped(): boolean;
}

/**
 * Issue #1523 (the board split): the runs' slots and what holds the queue: the person's pause,
 * the plan quota, memory and the budgets. Workflow runs back from a gate are served first.
 */
export class RunQueue {
  /** Cards holding one of the `maxParallelRuns` slots (preparing or with a turn going). */
  private readonly running = new Set<string>();
  /** Workflow turns waiting for the plan quota to free up. */
  private readonly quotaWaiters: Array<() => void> = [];
  /** Workflow runs back from a gate, waiting for a slot; served before queued cards. */
  private readonly waiters: Array<{ cardId: string; resume(): void }> = [];
  private limit: number;
  private readonly unwatch: Array<() => void> = [];

  constructor(private readonly port: RunQueuePort) {
    this.limit = port.opts.maxParallelRuns ?? 2;
  }

  /** Listens to the quota, memory, the pause and the budgets: a change may let queued cards go. */
  watchLimits(): void {
    const { quota, memory, pause, budgets } = this.port.opts;
    for (const source of [quota, memory, pause, budgets]) {
      const stop = source?.watch(() => this.onLimits());
      if (stop) this.unwatch.push(stop);
    }
  }

  /** Stops listening to the limits (the board stops). */
  dispose(): void {
    for (const stop of this.unwatch.splice(0)) stop();
  }

  /** Whether the card holds a slot. */
  has(cardId: string): boolean {
    return this.running.has(cardId);
  }

  /** A workflow run takes the card's slot back after a restart. */
  hold(cardId: string): void {
    this.running.add(cardId);
  }

  get maxParallelRuns(): number {
    return this.limit;
  }

  /** A higher limit starts queued cards right away; a lower one lets running ones finish. */
  setLimit(value: number): void {
    this.limit = value;
    this.pump();
  }

  /** Starts queued runs, oldest first, while there are free slots. */
  pump(): void {
    while (this.running.size < this.limit) {
      const waiter = this.waiters.shift();
      if (waiter) {
        this.running.add(waiter.cardId);
        waiter.resume();
        continue;
      }
      // Paused by the person (#1404), queued cards wait for the resume; runs going on finish.
      if (this.port.opts.pause?.blocked()) return;
      // Over the plan quota, queued cards wait for the window to reset (runs going on do not).
      if (this.port.opts.quota?.blocked()) return;
      // Short of memory (#1343), they wait for it to free up; the gate lets them go on any doubt.
      if (this.port.opts.memory?.blocked()) return;
      // The oldest queued card whose budget lets it go: a held project never stalls the others.
      const next = this.port.db
        .query<RunRow & { project_id: string }, []>(
          `SELECT r.*, c.project_id FROM card_runs r JOIN cards c ON c.id = r.card_id
           WHERE r.started_at IS NULL AND r.ended_at IS NULL ORDER BY r.queued_at, r.rowid`,
        )
        .all()
        .find((run) => !this.budgetBlocked(run.project_id));
      if (!next) return;
      this.running.add(next.card_id);
      this.port.db.query("UPDATE card_runs SET started_at = ? WHERE id = ?").run(now(), next.id);
      this.port.changed(next.card_id);
      void this.port.launch(next.card_id, next.id).catch((error: unknown) => {
        // After stop() the failure is the shutdown's (a closed database): nothing to record.
        if (this.port.stopped()) return;
        this.port.failRun(
          next.card_id,
          next.id,
          error instanceof Error ? error.message : String(error),
          error,
        );
      });
    }
  }

  /** Why a queued card waits, for the card itself: the pause, the quota, memory, a budget, then a slot. */
  queueState(queued: boolean, projectId: string): Pick<Card, "queueReason" | "quotaUntil"> {
    // The person's own pause (#1404) is named first: it is the hold they can lift.
    if (queued && this.port.opts.pause?.blocked())
      return { queueReason: "paused", quotaUntil: null };
    const blocked = queued ? this.port.opts.quota?.blocked() : null;
    if (blocked) {
      const until = blocked.until === null ? null : new Date(blocked.until).toISOString();
      return { queueReason: "quota", quotaUntil: until };
    }
    if (queued && this.port.opts.memory?.blocked())
      return { queueReason: "memory", quotaUntil: null };
    if (queued && this.budgetBlocked(projectId)) return { queueReason: "budget", quotaUntil: null };
    return { queueReason: queued ? "slot" : null, quotaUntil: null };
  }

  /** A `queue` budget of the host or of the card's project is at 100%. */
  budgetBlocked(projectId: string): boolean {
    if (!this.port.opts.budgets) return false;
    const { path } = this.port.project(projectId);
    return this.port.opts.budgets.blocked(this.port.opts.projectKeys?.known(path) ?? path);
  }

  /** A workflow turn about to start over the quota waits for it; `null` when it may go. */
  waitQuota(): { until: number | null; done: Promise<void> } | null {
    const blocked = this.port.opts.quota?.blocked();
    if (!blocked) return null;
    return {
      until: blocked.until,
      done: new Promise((resolve) => this.quotaWaiters.push(resolve)),
    };
  }

  /** A new quota reading, a reset or a budget change: queued cards may go, or say why not. */
  private onLimits(): void {
    if (!this.port.opts.quota?.blocked()) {
      for (const resume of this.quotaWaiters.splice(0)) resume();
    }
    this.pump();
    const queued = this.port.db
      .query<{ card_id: string }, []>(
        "SELECT DISTINCT card_id FROM card_runs WHERE started_at IS NULL AND ended_at IS NULL",
      )
      .all();
    for (const { card_id } of queued) this.port.changed(card_id);
  }

  /** A slot for a card whose workflow run goes on after a gate. */
  acquire(cardId: string): Promise<void> {
    return new Promise((resume) => {
      this.waiters.push({ cardId, resume });
      this.pump();
    });
  }

  /** Free slots taken right away for the items of a parallel step, each under its own key. */
  takeSlots(cardId: string, count: number): string[] {
    const keys: string[] = [];
    while (keys.length < count && this.running.size < this.limit) {
      const key = `${cardId}/${ulid()}`;
      this.running.add(key);
      keys.push(key);
    }
    return keys;
  }

  /** The card's run stopped holding a slot: the next one in the queue goes. */
  release(cardId: string): void {
    if (this.running.delete(cardId)) this.pump();
  }
}
