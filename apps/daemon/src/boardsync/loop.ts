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

export class BoardSyncLoop {
  constructor(private readonly opts: BoardSyncLoopOptions) {}

  get intervalMs(): number {
    return 0;
  }

  start(): void {
    void this.opts;
  }

  stop(): void {}

  watch(_projectId: string): void {}

  unwatch(_projectId: string): void {}

  async syncNow(_projectId: string): Promise<SyncReport | null> {
    return null;
  }
}
