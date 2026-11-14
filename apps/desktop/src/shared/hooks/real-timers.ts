/** The clock and timers of the hook; the real ones by default (tests drive their own). */
export interface MinLoadingTimers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** The clock and timers the in-flight hooks use unless a test hands them its own. */
export const REAL_TIMERS: MinLoadingTimers = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
