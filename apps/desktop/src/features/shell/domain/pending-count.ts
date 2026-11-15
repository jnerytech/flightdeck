import { budgetAlerts } from "../../costs/index.ts";
import { quietAlerts } from "../../needs-you/index.ts";
import { watchAlerts } from "../../watch/index.ts";

/** The part of the app's state the badge counts: what each kind of alert reads, and the loop alerts. */
type PendingCountState = Parameters<typeof budgetAlerts>[0] &
  Parameters<typeof watchAlerts>[0] &
  Parameters<typeof quietAlerts>[0] & { loopAlerts: readonly unknown[] };

/** The number on the Needs you badge: the requests, and the budget, loop, watch and quiet alerts. */
export function pendingCount(state: PendingCountState, requests: number, nowMs: number): number {
  return (
    requests +
    budgetAlerts(state).length +
    state.loopAlerts.length +
    watchAlerts(state).length +
    quietAlerts(state, nowMs).length
  );
}
