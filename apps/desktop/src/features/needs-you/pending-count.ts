import type { AppState } from "../../lib/app-store.ts";

/** The number on the Needs you badge: the requests, and the budget, loop, watch and quiet alerts. */
export function pendingCount(_state: AppState, _requests: number, _nowMs: number): number {
  return -1;
}
