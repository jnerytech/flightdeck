/**
 * Issue #1343: new card runs wait while the host's memory is at or above `resources.pauseAt`.
 * The reading is the Resources panel's own (total and free memory; on Linux, Bun's free memory is
 * MemAvailable), so the hold agrees with what the panel shows. Every doubt lets runs go: no
 * threshold, no reading, a reading that throws or makes no sense.
 */
import { realTimers, type Timers } from "../quota/quota.ts";

/** The host's memory as the OS reports it. */
export interface MemoryReading {
  totalBytes: number;
  freeBytes: number;
}

export interface MemoryGateOptions {
  /** From this share of used memory (0 to 1) on, new runs wait; null turns the hold off. */
  pauseAt: number | null;
  /** The host's memory now; null or a throw when it cannot be read. */
  read(): MemoryReading | null;
  /** How often a watched gate reads again, in ms (15 s by default). */
  everyMs?: number;
  timers?: Timers;
}

/** The default share of used memory from which new runs wait. */
export const MEMORY_PAUSE_AT = 0.9;

/** The share of memory in use, or null when the reading cannot be trusted. */
function usedShare(read: () => MemoryReading | null): number | null {
  let reading: MemoryReading | null;
  try {
    reading = read();
  } catch {
    return null;
  }
  if (!reading) return null;
  const { totalBytes, freeBytes } = reading;
  if (!Number.isFinite(totalBytes) || !Number.isFinite(freeBytes) || totalBytes <= 0) return null;
  if (freeBytes < 0 || freeBytes > totalBytes) return null;
  return (totalBytes - freeBytes) / totalBytes;
}

export class MemoryGate {
  private threshold: number | null;
  private readonly timers: Timers;
  private readonly listeners = new Set<() => void>();
  private timer: unknown = null;
  /** Whether the last look held new runs, so a watcher hears only of a change. */
  private holding = false;

  constructor(private readonly opts: MemoryGateOptions) {
    this.threshold = opts.pauseAt;
    this.timers = opts.timers ?? realTimers;
  }

  /** The share of memory in use when it holds new runs, or null when they may go. */
  blocked(): { used: number } | null {
    if (this.threshold === null) return null;
    const share = usedShare(this.opts.read);
    if (share === null) return null;
    // To a tenth of a percent, the panel's precision: 90% in use is at a 0.9 threshold.
    const used = Math.round(share * 1000) / 1000;
    return used < this.threshold ? null : { used };
  }

  /** The threshold in force (0 to 1), or null when the hold is off. */
  pauseAt(): number | null {
    return this.threshold;
  }

  /** A new threshold; the watchers hear of it at once. */
  setPauseAt(pauseAt: number | null): void {
    this.threshold = pauseAt;
    this.holding = this.blocked() !== null;
    for (const listener of this.listeners) listener();
  }

  /** Calls `listener` whenever the hold starts or ends; reads every `everyMs` while watched. */
  watch(listener: () => void): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.holding = this.blocked() !== null;
      this.schedule();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.timer !== null) {
        this.timers.clear(this.timer);
        this.timer = null;
      }
    };
  }

  /** The next look, while someone watches. */
  private schedule(): void {
    this.timer = this.timers.set(() => {
      this.timer = null;
      if (this.listeners.size === 0) return;
      const holding = this.blocked() !== null;
      if (holding !== this.holding) {
        this.holding = holding;
        for (const listener of this.listeners) listener();
      }
      this.schedule();
    }, this.opts.everyMs ?? 15_000);
  }
}
