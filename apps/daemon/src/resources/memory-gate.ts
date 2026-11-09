/**
 * Issue #1343: new card runs wait while the host's memory is at or above `resources.pauseAt`.
 * The reading is the Resources panel's own (total and free memory; on Linux, Bun's free memory is
 * MemAvailable), so the hold agrees with what the panel shows. Every doubt lets runs go: no
 * threshold, no reading, a reading that throws or makes no sense.
 */
import type { Timers } from "../quota/quota.ts";

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

export class MemoryGate {
  constructor(private readonly opts: MemoryGateOptions) {}

  /** The share of memory in use when it holds new runs, or null when they may go. */
  blocked(): { used: number } | null {
    return null;
  }

  /** The threshold in force (0 to 1), or null when the hold is off. */
  pauseAt(): number | null {
    return null;
  }

  /** A new threshold; the watchers hear of it at once. */
  setPauseAt(_pauseAt: number | null): void {}

  /** Calls `listener` whenever the hold starts or ends; reads every `everyMs` while watched. */
  watch(_listener: () => void): () => void {
    return () => {};
  }
}
