import { createContext, useContext, useEffect, useState } from "react";
import type { MinLoadingTimers } from "./use-min-loading.ts";

/**
 * The one rule for work a person is waiting on (a click's command, a form, a panel loading):
 * under `quietMs` nothing changes on screen; to `spinnerMs` the control only looks busy; from
 * there a spinner; from `slowMs` it also says it is still working (or the stage the caller
 * names). A loading panel draws its placeholders only after `deferMs`. The control is busy and
 * ignores a second click from the first millisecond: only what is drawn waits.
 */
export const IN_FLIGHT = { quietMs: 100, spinnerMs: 1000, slowMs: 3000, deferMs: 200 };

export type InFlightStage = "idle" | "quiet" | "pending" | "spinner" | "slow";

const REAL: MinLoadingTimers = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** The clock of the hooks below; the real one by default, a test's own through the provider. */
export const InFlightTimers = createContext<MinLoadingTimers>(REAL);

/** The stage `elapsedMs` after the work started. */
export function inFlightStage(elapsedMs: number): Exclude<InFlightStage, "idle"> {
  if (elapsedMs >= IN_FLIGHT.slowMs) return "slow";
  if (elapsedMs >= IN_FLIGHT.spinnerMs) return "spinner";
  if (elapsedMs >= IN_FLIGHT.quietMs) return "pending";
  return "quiet";
}

const STEPS = [
  { at: IN_FLIGHT.quietMs, stage: "pending" },
  { at: IN_FLIGHT.spinnerMs, stage: "spinner" },
  { at: IN_FLIGHT.slowMs, stage: "slow" },
] as const;

/** The stage of the work while `active`; `"idle"` when it is not going on. */
export function useInFlight(active: boolean): InFlightStage {
  const timers = useContext(InFlightTimers);
  const [stage, setStage] = useState<Exclude<InFlightStage, "idle">>("quiet");
  useEffect(() => {
    if (!active) return;
    setStage("quiet");
    const handles = STEPS.map((step) => timers.setTimeout(() => setStage(step.stage), step.at));
    return () => {
      for (const handle of handles) timers.clearTimeout(handle);
    };
  }, [active, timers]);
  return active ? stage : "idle";
}

/** True once `ms` have passed since the first render: for placeholders that should not flash. */
export function useAfter(ms: number): boolean {
  const timers = useContext(InFlightTimers);
  const [passed, setPassed] = useState(ms <= 0);
  useEffect(() => {
    if (ms <= 0) return;
    const handle = timers.setTimeout(() => setPassed(true), ms);
    return () => timers.clearTimeout(handle);
  }, [ms, timers]);
  return passed;
}
