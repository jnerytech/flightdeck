/**
 * Issue #1343: new card runs wait while the host's memory is at or above `resources.pauseAt`.
 * The reading is the Resources panel's own (total and free memory; on Linux, Bun's free memory is
 * MemAvailable), so the hold agrees with what the panel shows. Every doubt lets runs go: no
 * threshold, no reading, a reading that throws or makes no sense.
 */
import { realTimers, type Timers } from "../quota/index.ts";

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
/** Once holding, runs go again only this far under the threshold, so the hold does not flap. */
export const MEMORY_RELEASE_MARGIN = 0.02;

/**
 * The OS's memory as the hold reads it, or null where it would mislead. Linux (WSL too) gives
 * MemAvailable through Bun's free memory and Windows its available physical memory, both with the
 * reclaimable cache counted as free; macOS counts that cache as used, so a Mac would sit above 90%.
 */
export function osMemoryReading(os: {
  platform: NodeJS.Platform;
  totalmem(): number;
  freemem(): number;
}): MemoryReading | null {
  if (os.platform === "darwin") return null;
  return { totalBytes: os.totalmem(), freeBytes: os.freemem() };
}

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
  /** Whether the last look held new runs: a watcher hears only of a change, and the margin applies. */
  private holding = false;

  constructor(private readonly opts: MemoryGateOptions) {
    this.threshold = opts.pauseAt;
    this.timers = opts.timers ?? realTimers;
  }

  /**
   * The share of memory in use when it holds new runs, or null when they may go. Holding, it goes on
   * holding until memory is `MEMORY_RELEASE_MARGIN` under the threshold.
   */
  blocked(): { used: number } | null {
    const share = this.share(this.holding);
    this.holding = share !== null;
    this.poll();
    return share === null ? null : { used: share };
  }

  /** The share in use when it holds (from the margin when `holding`), else null. */
  private share(holding: boolean): number | null {
    const used = this.threshold === null ? null : usedShare(this.opts.read);
    if (this.threshold === null || used === null) return null;
    // To a tenth of a percent, the panel's precision: 90% in use is at a 0.9 threshold.
    const share = Math.round(used * 1000) / 1000;
    const from = holding ? this.threshold - MEMORY_RELEASE_MARGIN : this.threshold;
    return share >= from ? share : null;
  }

  /**
   * Whether the gate holds now, by its rule and margin, without changing what it remembers: a client
   * that asks (issue #1414) never takes a release from the watchers, who hear it on the next look.
   */
  holds(): boolean {
    return this.share(this.holding) !== null;
  }

  /** The threshold in force (0 to 1), or null when the hold is off. */
  pauseAt(): number | null {
    return this.threshold;
  }

  /** A new threshold; the watchers hear of it at once. */
  setPauseAt(pauseAt: number | null): void {
    this.threshold = pauseAt;
    // A new threshold is looked at afresh, not from the margin of the old one.
    this.holding = false;
    this.blocked();
    for (const listener of this.listeners) listener();
  }

  /**
   * Calls `listener` whenever the hold starts or ends. While it holds and is watched, it reads every
   * `everyMs` to see the hold end; released, nothing waits for memory and the next start reads
   * afresh, so an idle daemon keeps no timer.
   */
  watch(listener: () => void): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.blocked();
    return () => {
      this.listeners.delete(listener);
      this.poll();
    };
  }

  /** Keeps the timer running exactly while the gate holds and someone watches. */
  private poll(): void {
    if (this.holding && this.listeners.size > 0) {
      if (this.timer === null)
        this.timer = this.timers.set(() => this.look(), this.opts.everyMs ?? 15_000);
      return;
    }
    if (this.timer !== null) {
      this.timers.clear(this.timer);
      this.timer = null;
    }
  }

  /** One timed look: the watchers hear only of a change. */
  private look(): void {
    this.timer = null;
    const before = this.holding;
    this.blocked();
    if (this.holding !== before) for (const listener of this.listeners) listener();
  }
}
