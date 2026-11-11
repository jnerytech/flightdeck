import type { QuotaWindow } from "@flightdeck/protocol";

/**
 * Issue #933: the plan quota belongs to the account, not to a host. Readings of the same window
 * whose resets are this close are one account's, however many hosts report them and however the
 * seconds of the reset move between polls.
 */
const SAME_RESET_MS = 10 * 60 * 1000;
/** Levels past the host's `pauseAt` that are told again: nearly out, and out. */
const LEVELS = [0.95, 1];

/**
 * How far a reading is over the thresholds: 0 under `pauseAt` (or with it off); 1 at `pauseAt`; one
 * more for each of 95% and 100% it reaches; the last for a window the plan rejected.
 */
export function quotaLevel(window: QuotaWindow, pauseAt: number | null): number {
  if (pauseAt === null) return 0;
  const thresholds = [...new Set([pauseAt, ...LEVELS.filter((t) => t >= pauseAt)])].sort(
    (a, b) => a - b,
  );
  if (window.status === "rejected") return thresholds.length;
  const used = window.utilization ?? 0;
  return thresholds.filter((t) => used >= t).length;
}

interface Seen {
  window: string;
  resetsAt: number | null;
  /** The highest level told for this reset. */
  level: number;
}

/** What was told of the plan quota, by window and reset, so a notice comes once per level. */
export class QuotaNotices {
  private seen: Seen[] = [];

  /**
   * Whether this reading is news: a higher level than the one told for its window and reset. Use
   * that falls back, or a window that resets, starts over.
   */
  check(window: QuotaWindow, pauseAt: number | null, now: number): boolean {
    // A window past its reset is over: what was told for it is forgotten.
    this.seen = this.seen.filter((s) => s.resetsAt === null || s.resetsAt > now);
    const resetsAt = window.resetsAt === null ? null : Date.parse(window.resetsAt);
    let entry = this.seen.find(
      (s) =>
        s.window === window.window &&
        (s.resetsAt === null || resetsAt === null
          ? s.resetsAt === resetsAt
          : Math.abs(s.resetsAt - resetsAt) < SAME_RESET_MS),
    );
    if (!entry) {
      entry = { window: window.window, resetsAt, level: 0 };
      this.seen.push(entry);
    }
    const level = quotaLevel(window, pauseAt);
    const news = level > entry.level;
    entry.level = level;
    return news;
  }
}
