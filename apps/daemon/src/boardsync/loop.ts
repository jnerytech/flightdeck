/**
 * Phase 38: the polling loop. One timer per linked project, one run at a time per project, a back
 * off after errors, and a pause until the reset time when the provider's rate limit was reached.
 */
import type { Timers } from "../quota/quota.ts";
import type { SyncReport } from "./engine.ts";
import type { BoardSyncStore } from "./store.ts";

export const DEFAULT_INTERVAL_MS = 60_000;
export const MIN_INTERVAL_MS = 15_000;
export const MAX_INTERVAL_MS = 10 * 60_000;
export const MAX_BACKOFF_MS = 15 * 60_000;

export interface BoardSyncLoopOptions {
  engine: { syncProject(projectId: string): Promise<SyncReport> };
  store: BoardSyncStore;
  timers: Timers;
  clock?: () => number;
  intervalMs?: number;
  /** Told after every run, finished well or not. */
  onUpdate?: (projectId: string) => void;
}

interface Watched {
  timer: unknown | null;
  running: Promise<SyncReport | null> | null;
  failures: number;
}

export class BoardSyncLoop {
  private readonly watched = new Map<string, Watched>();
  private readonly clock: () => number;
  private stopped = true;
  readonly intervalMs: number;

  constructor(private readonly opts: BoardSyncLoopOptions) {
    this.clock = opts.clock ?? Date.now;
    this.intervalMs = Math.min(
      MAX_INTERVAL_MS,
      Math.max(MIN_INTERVAL_MS, opts.intervalMs ?? DEFAULT_INTERVAL_MS),
    );
  }

  /** Watches every linked project; the first run is at once. */
  start(): void {
    this.stopped = false;
    for (const link of this.opts.store.list()) this.watch(link.projectId);
  }

  stop(): void {
    this.stopped = true;
    for (const projectId of [...this.watched.keys()]) this.unwatch(projectId);
  }

  watch(projectId: string): void {
    if (this.stopped || this.watched.has(projectId)) return;
    this.watched.set(projectId, { timer: null, running: null, failures: 0 });
    this.schedule(projectId, 0);
  }

  unwatch(projectId: string): void {
    const entry = this.watched.get(projectId);
    if (entry?.timer != null) this.opts.timers.clear(entry.timer);
    this.watched.delete(projectId);
  }

  /** Runs the project's sync at once; a run already going is the answer. */
  syncNow(projectId: string): Promise<SyncReport | null> {
    const entry = this.watched.get(projectId);
    if (!entry) return this.run(projectId, { timer: null, running: null, failures: 0 });
    if (entry.timer != null) this.opts.timers.clear(entry.timer);
    entry.timer = null;
    return this.run(projectId, entry);
  }

  private schedule(projectId: string, delayMs: number): void {
    const entry = this.watched.get(projectId);
    if (!entry || this.stopped) return;
    if (entry.timer != null) this.opts.timers.clear(entry.timer);
    entry.timer = this.opts.timers.set(() => {
      entry.timer = null;
      void this.run(projectId, entry);
    }, delayMs);
  }

  private run(projectId: string, entry: Watched): Promise<SyncReport | null> {
    if (entry.running) return entry.running;
    const running = this.sync(projectId, entry).finally(() => {
      entry.running = null;
    });
    entry.running = running;
    return running;
  }

  private async sync(projectId: string, entry: Watched): Promise<SyncReport | null> {
    const { store } = this.opts;
    let next = this.intervalMs;
    let report: SyncReport | null = null;
    try {
      report = await this.opts.engine.syncProject(projectId);
      entry.failures = 0;
      if (store.get(projectId)?.pausedUntil) store.update(projectId, { pausedUntil: null });
    } catch (error) {
      entry.failures += 1;
      next = Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** (entry.failures - 1));
      const failed = error as { reason?: string; params?: { resetAt?: string } };
      if (failed.reason === "board_sync_rate_limited" && failed.params?.resetAt) {
        // Nothing is asked of GitHub before the limit resets.
        const wait = Date.parse(failed.params.resetAt) - this.clock();
        next = Math.max(this.intervalMs, wait);
        if (store.get(projectId)) store.update(projectId, { pausedUntil: failed.params.resetAt });
      }
    }
    this.opts.onUpdate?.(projectId);
    this.schedule(projectId, next);
    return report;
  }
}
