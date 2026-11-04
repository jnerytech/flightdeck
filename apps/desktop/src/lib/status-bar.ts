import type { QuotaState } from "@flightdeck/protocol";

/** The plan quota at a glance: the window under most pressure and how long until it resets. */
export interface QuotaGlance {
  window: string;
  percent: number;
  /** "3d 9h", "3h 47m" or "12m": time until the window resets; empty when the host did not say. */
  remaining: string;
}

/** The time left as the two largest units: "3d 9h", "3h 47m", "12m"; "0m" for what has passed. */
export function shortDuration(_ms: number): string {
  return "";
}

/** The most used window across the online hosts that report one; `null` while none does. */
export function quotaGlance(
  _quota: Record<string, QuotaState | undefined>,
  _onlineIds: string[],
  _now: number,
): QuotaGlance | null {
  return null;
}
