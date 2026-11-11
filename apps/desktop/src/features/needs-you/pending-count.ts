import type { AppState } from "../../lib/app-store.ts";
import { quietAlerts } from "../../lib/quiet.ts";
import { watchAlerts } from "../../lib/watch-alerts.ts";
import { budgetAlerts } from "../costs/index.ts";

/** The number on the Needs you badge: the requests, and the budget, loop, watch and quiet alerts. */
export function pendingCount(state: AppState, requests: number, nowMs: number): number {
  return (
    requests +
    budgetAlerts(state).length +
    state.loopAlerts.length +
    watchAlerts(state).length +
    quietAlerts(state, nowMs).length
  );
}
