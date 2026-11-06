import type { QuotaState } from "@flightdeck/protocol";

/** How close the window is to its limit: from 80% near, at 100% reached (the account card's thresholds). */
export type QuotaLevel = "ok" | "near" | "reached";

/** The plan window under most pressure across the online hosts (issue #118). */
export interface QuotaGlance {
  hostId: string;
  window: string;
  percent: number;
  /** "3d 9h", "3h 47m" or "12m" until it resets; empty when the host did not say. */
  remaining: string;
  level: QuotaLevel;
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

function levelOf(utilization: number): QuotaLevel {
  if (utilization >= 1) return "reached";
  return utilization >= 0.8 ? "near" : "ok";
}

/** The most used window across the online hosts that report one; `null` while none does. */
export function quotaGlance(
  quota: Record<string, QuotaState | undefined>,
  onlineIds: string[],
  now: number,
): QuotaGlance | null {
  let best: {
    hostId: string;
    window: string;
    utilization: number;
    resetsAt: string | null;
  } | null = null;
  for (const hostId of onlineIds) {
    for (const w of quota[hostId]?.windows ?? []) {
      if (w.utilization === null) continue;
      if (!best || w.utilization > best.utilization) {
        best = { hostId, window: w.window, utilization: w.utilization, resetsAt: w.resetsAt };
      }
    }
  }
  if (!best) return null;
  return {
    hostId: best.hostId,
    window: best.window,
    percent: Math.round(best.utilization * 100),
    remaining: best.resetsAt ? shortDuration(Date.parse(best.resetsAt) - now) : "",
    level: levelOf(best.utilization),
  };
}
