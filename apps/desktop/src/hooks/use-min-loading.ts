import { useEffect, useRef, useState } from "react";
import { IN_FLIGHT } from "./use-in-flight.ts";

/** The clock and timers of the hook; the real ones by default (tests drive their own). */
export interface MinLoadingTimers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** A loading state that, once its placeholders are drawn (after `IN_FLIGHT.deferMs`), stays on for at least `MIN_LOADING_MS`, so it never flashes. */
export const MIN_LOADING_MS = 150;

const REAL: MinLoadingTimers = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function useMinLoading(loading: boolean, timers: MinLoadingTimers = REAL): boolean {
  const [shown, setShown] = useState(loading);
  const since = useRef(loading ? timers.now() : 0);
  useEffect(() => {
    if (loading) {
      if (!shown) since.current = timers.now();
      setShown(true);
      return;
    }
    // The placeholders are drawn after `deferMs`; the minimum counts from then, and a load that
    // ended before that never drew them, so it has nothing to hold.
    const drawnFor = timers.now() - since.current - IN_FLIGHT.deferMs;
    const left = drawnFor <= 0 ? 0 : MIN_LOADING_MS - drawnFor;
    if (left <= 0) {
      setShown(false);
      return;
    }
    const handle = timers.setTimeout(() => setShown(false), left);
    return () => timers.clearTimeout(handle);
  }, [loading, shown, timers]);
  // The first frame after a change of `loading` already agrees with it when it turns on.
  return loading || shown;
}
