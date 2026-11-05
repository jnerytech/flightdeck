import { createContext } from "react";
import type { MinLoadingTimers } from "./use-min-loading.ts";

/** Stub: wrong values until the area is green. */
export const IN_FLIGHT = { quietMs: 0, spinnerMs: 0, slowMs: 0, deferMs: 0 };

export type InFlightStage = "idle" | "quiet" | "pending" | "spinner" | "slow";

export const InFlightTimers = createContext<MinLoadingTimers | null>(null);

export function inFlightStage(_elapsedMs: number): Exclude<InFlightStage, "idle"> {
  return "quiet";
}

export function useInFlight(_active: boolean): InFlightStage {
  return "idle";
}
