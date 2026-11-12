import type { MinLoadingTimers } from "./use-min-loading.ts";

/** The clock and timers the in-flight hooks use unless a test hands them its own. */
export const REAL_TIMERS: MinLoadingTimers = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
