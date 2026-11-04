import type { QuotaState } from "@flightdeck/protocol";

/** The plan quota at a glance: the window under most pressure and how long until it resets. */
export interface QuotaGlance {
  window: string;
  percent: number;
  /** "3d 9h", "3h 47m" or "12m": time until the window resets; empty when the host did not say. */
  remaining: string;
}

/** The time left as the two largest units: "3d 9h", "3h 47m", "12m"; "0m" for what has passed. */
export function shortDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

/** The most used window across the online hosts that report one; `null` while none does. */
export function quotaGlance(
  quota: Record<string, QuotaState | undefined>,
  onlineIds: string[],
  now: number,
): QuotaGlance | null {
  let best: { window: string; utilization: number; resetsAt: string | null } | null = null;
  for (const id of onlineIds) {
    for (const w of quota[id]?.windows ?? []) {
      if (w.utilization === null) continue;
      if (!best || w.utilization > best.utilization) {
        best = { window: w.window, utilization: w.utilization, resetsAt: w.resetsAt };
      }
    }
  }
  if (!best) return null;
  return {
    window: best.window,
    percent: Math.round(best.utilization * 100),
    remaining: best.resetsAt ? shortDuration(Date.parse(best.resetsAt) - now) : "",
  };
}
