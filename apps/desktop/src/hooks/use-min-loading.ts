import { useEffect, useRef, useState } from "react";

/** The clock and timers of the hook; the real ones by default (tests drive their own). */
export interface MinLoadingTimers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** A loading state that, once shown, stays on for at least `MIN_LOADING_MS`, so it never flashes. */
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
    const left = MIN_LOADING_MS - (timers.now() - since.current);
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
