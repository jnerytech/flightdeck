import type { QuotaState, QuotaWindow } from "@flightdeck/protocol";
import { isHot } from "./quota";

/** How close the window is to its limit: from 80% near; reached at 100%, at the host's `pauseAt` or refused. */
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

const RANK: Record<QuotaLevel, number> = { ok: 0, near: 1, reached: 2 };

/** Reached at 100%, or as the account card's red bar (at `pauseAt`, or refused); near from 80%. */
function levelOf(window: QuotaWindow, utilization: number, pauseAt: number | null): QuotaLevel {
  if (utilization >= 1 || isHot(window, pauseAt)) return "reached";
  return utilization >= 0.8 ? "near" : "ok";
}

/**
 * The window under most pressure across the online hosts that report one: the highest level, then
 * the most used; `null` while none does.
 */
export function quotaGlance(
  quota: Record<string, QuotaState | undefined>,
  onlineIds: string[],
  now: number,
): QuotaGlance | null {
  let best: (QuotaGlance & { utilization: number }) | null = null;
  for (const hostId of onlineIds) {
    const state = quota[hostId];
    for (const w of state?.windows ?? []) {
      if (w.utilization === null) continue;
      const level = levelOf(w, w.utilization, state?.pauseAt ?? null);
      const ahead =
        !best ||
        RANK[level] > RANK[best.level] ||
        (RANK[level] === RANK[best.level] && w.utilization > best.utilization);
      if (ahead) {
        best = {
          hostId,
          window: w.window,
          utilization: w.utilization,
          percent: Math.round(w.utilization * 100),
          remaining: w.resetsAt ? shortDuration(Date.parse(w.resetsAt) - now) : "",
          level,
        };
      }
    }
  }
  if (!best) return null;
  const { utilization: _, ...glance } = best;
  return glance;
}
