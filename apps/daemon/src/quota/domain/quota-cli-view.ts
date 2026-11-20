/**
 * Issue #3460: what `flightdeckd quota` says, as pure rules over the answers of the daemon. The
 * daemon calls and the timer stay in `quota/quota-cli.ts`.
 */
import type { QuotaHistory, QuotaState } from "@flightdeck/protocol";

export interface QuotaCliArgs {
  action: "get" | "history" | "pause-at";
  /** `history`: the window (`five_hour`, `seven_day`). */
  window?: string;
  /** `history`: how many hours back. */
  hours?: number;
  /** `pause-at`: a share from 0 to 1; `null` turns the guard off. */
  pauseAt?: number | null;
  json?: boolean;
}

export function stateLines(_state: QuotaState): string[] {
  return [];
}

export function historyLines(_history: QuotaHistory): string[] {
  return [];
}
