import type { QuotaState, QuotaWindow } from "@flightdeck/protocol";
import type { QuotaReading } from "../runtime/index.ts";

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface QuotaOptions {
  /** Utilization (0 to 1) from which new cards wait; `null` turns the queue off. */
  pauseAt: number | null;
  /** Milliseconds now. */
  now?: () => number;
  timers?: Timers;
}

/** The longest delay a timer takes (2³¹ − 1 ms, about 24.8 days); longer ones fire at once. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** The plan quota of the host: the last reading of each window, from any managed session. */
export class Quota {
  private readonly readings = new Map<string, { reading: QuotaReading; readAt: number }>();
  private readonly watchers = new Set<(state: QuotaState) => void>();
  private readonly now: () => number;
  private readonly timers: Timers;
  private timer: unknown = null;

  constructor(private readonly opts: QuotaOptions) {
    this.now = opts.now ?? Date.now;
    this.timers = opts.timers ?? realTimers;
  }

  /** New readings replace those of the same window; one already past its reset is dropped. */
  record(readings: QuotaReading[]): void {
    const now = this.now();
    for (const reading of readings) {
      if (reading.resetsAt !== null && reading.resetsAt <= now)
        this.readings.delete(reading.window);
      else this.readings.set(reading.window, { reading, readAt: now });
    }
    this.changed();
  }

  /** Valid readings: one past its `resetsAt` no longer counts until a new one arrives. */
  windows(): QuotaWindow[] {
    return this.valid().map(({ reading, readAt }) => ({
      window: reading.window,
      utilization: reading.utilization,
      status: reading.status,
      resetsAt: reading.resetsAt === null ? null : new Date(reading.resetsAt).toISOString(),
      readAt: new Date(readAt).toISOString(),
    }));
  }

  /** Why new cards must wait now (`until` in ms, `null` when unknown), or `null`. */
  blocked(): { window: string; until: number | null } | null {
    const { pauseAt } = this.opts;
    if (pauseAt === null) return null;
    const over = this.valid()
      .map(({ reading }) => reading)
      .filter((r) => r.status === "rejected" || (r.utilization ?? 0) >= pauseAt);
    const [first] = over;
    if (!first) return null;
    // Free again once every window over the limit has reset.
    const resets = over.flatMap((r) => r.resetsAt ?? []);
    return {
      window: first.window,
      until: resets.length === over.length ? Math.max(...resets) : null,
    };
  }

  /** Changes the guard: from this utilization new cards wait (`null` turns it off). */
  setPauseAt(pauseAt: number | null): void {
    this.opts.pauseAt = pauseAt;
    this.changed();
  }

  state(): QuotaState {
    return { windows: this.windows(), pauseAt: this.opts.pauseAt };
  }

  /** Gets the state after each new reading and each expiry; returns the function that stops it. */
  watch(listener: (state: QuotaState) => void): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  stop(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  /** Drops what expired, arms the timer for the next reset and tells the watchers. */
  /** Readings not past their reset, even when the timer fires late (a host that slept). */
  private valid() {
    const now = this.now();
    return [...this.readings.values()].filter(
      ({ reading }) => reading.resetsAt === null || reading.resetsAt > now,
    );
  }

  private changed(): void {
    const now = this.now();
    for (const [window, { reading }] of this.readings) {
      if (reading.resetsAt !== null && reading.resetsAt <= now) this.readings.delete(window);
    }
    this.stop();
    const resets = [...this.readings.values()].flatMap(({ reading }) => reading.resetsAt ?? []);
    if (resets.length > 0) {
      // Timers take 32-bit delays: a later reset re-arms on the way, since this recomputes.
      const delay = Math.min(Math.min(...resets) - now, MAX_TIMER_MS);
      this.timer = this.timers.set(() => this.changed(), delay);
    }
    const state = this.state();
    for (const watcher of this.watchers) {
      try {
        watcher(state);
      } catch {
        // A broken watcher must not stop the others.
      }
    }
  }
}
