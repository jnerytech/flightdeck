import type { Timers } from "../src/quota/quota.ts";

/** A clock that only moves by hand and timers that fire only when it moves past them. */
export function manualTime(start = Date.UTC(2026, 9, 1, 12, 0, 0)) {
  let now = start;
  const pending: Array<{ fn: () => void; at: number; cleared: boolean }> = [];
  const timers: Timers = {
    set: (fn, ms) => {
      const timer = { fn, at: now + ms, cleared: false };
      pending.push(timer);
      return timer;
    },
    clear: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
  };
  /** Moves the clock and fires every timer that came due. */
  const advance = (ms: number) => {
    now += ms;
    for (const timer of pending.splice(0)) {
      if (timer.cleared) continue;
      if (timer.at <= now) timer.fn();
      else pending.push(timer);
    }
  };
  return { now: () => now, timers, advance, pending };
}
