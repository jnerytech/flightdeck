import type { QuotaState, QuotaWindow } from "@flightdeck/protocol";
import type { QuotaReading } from "../runtime/types.ts";

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
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

const STATUSES: ReadonlySet<string> = new Set(["allowed", "allowed_warning", "rejected"]);

/** One window of a `rate_limit_info` (or the info itself); `null` when it makes no sense. */
function reading(window: string, raw: unknown): QuotaReading | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { status, utilization, resetsAt } = raw as Record<string, unknown>;
  if (typeof status !== "string" || !STATUSES.has(status)) return null;
  return {
    window,
    utilization: typeof utilization === "number" ? utilization : null,
    status: status as QuotaReading["status"],
    // Seconds since the epoch on the wire.
    resetsAt: typeof resetsAt === "number" ? resetsAt * 1000 : null,
  };
}

/**
 * The windows of an SDK `rate_limit_info`, read defensively: `unifiedWindows` (not in the SDK
 * types, but sent by the CLI) when present, else the single window at the top.
 */
export function quotaReadings(info: unknown): QuotaReading[] {
  if (typeof info !== "object" || info === null) return [];
  const { unifiedWindows, rateLimitType } = info as Record<string, unknown>;
  const entries: Array<[string, unknown]> =
    typeof unifiedWindows === "object" && unifiedWindows !== null
      ? Object.entries(unifiedWindows)
      : typeof rateLimitType === "string"
        ? [[rateLimitType, info]]
        : [];
  return entries.flatMap(([window, raw]) => reading(window, raw) ?? []);
}

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
    return [...this.readings.values()].map(({ reading, readAt }) => ({
      window: reading.window,
      utilization: reading.utilization,
      status: reading.status,
      resetsAt: reading.resetsAt === null ? null : new Date(reading.resetsAt).toISOString(),
      readAt: new Date(readAt).toISOString(),
    }));
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
  private changed(): void {
    const now = this.now();
    for (const [window, { reading }] of this.readings) {
      if (reading.resetsAt !== null && reading.resetsAt <= now) this.readings.delete(window);
    }
    this.stop();
    const resets = [...this.readings.values()].flatMap(({ reading }) => reading.resetsAt ?? []);
    if (resets.length > 0) {
      this.timer = this.timers.set(() => this.changed(), Math.min(...resets) - now);
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
