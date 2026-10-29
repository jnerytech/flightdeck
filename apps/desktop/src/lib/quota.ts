import type { QuotaHistory, QuotaState, QuotaWindow } from "@flightdeck/protocol";
import { formatAgo } from "../i18n/format.ts";
import type { Key, T } from "../i18n/index.ts";

/** How many hours of samples each window's chart shows. */
export const HISTORY_HOURS: Record<string, number> = { five_hour: 24, seven_day: 168 };

/** "no ritmo atual, a janela de 5 h esgota às 16:00", or why it does not. */
export function projectionText(
  window: string,
  projection: QuotaHistory["projection"],
  formatTime: (iso: string) => string,
  t: T,
): string {
  if (!projection) return t("quota.projection.few");
  // Only the two windows the panel shows ask for a projection.
  const label = t(`quota.shortWindows.${window}` as Key);
  if (projection.exhaustsAt) {
    return t("quota.projection.exhausts", {
      window: label,
      time: formatTime(projection.exhaustsAt),
    });
  }
  return t("quota.projection.holds", { time: formatTime(projection.resetsAt ?? "") });
}

/** The two windows the app shows for every host, in order. */
export const SHOWN = ["five_hour", "seven_day"];

export interface QuotaBar {
  window: string;
  label: string;
  /** False until the host reports the window: no bar then. */
  hasReading: boolean;
  /** Fraction from 0 to 1; 0 without a reading. */
  value: number;
  percent: number;
  /** At or over `pauseAt` (or rejected): new cards wait. */
  hot: boolean;
  /** "reinicia às 15:00" and "lida há 12 min"; empty without a reading. */
  reset: string;
  age: string;
}

/** At or over the host's `pauseAt`, or rejected by the plan. */
export function isHot(window: QuotaWindow, pauseAt: number | null): boolean {
  if (pauseAt === null) return false;
  return window.status === "rejected" || (window.utilization ?? 0) >= pauseAt;
}

/** Percentage, reset time and age of the 5-hour and 7-day windows of a host. */
export function quotaBars(
  quota: QuotaState | undefined,
  now: number,
  formatTime: (iso: string) => string,
  t: T,
): QuotaBar[] {
  return SHOWN.map((window) => {
    const label = t(`quota.windows.${window}` as Key);
    const reading = quota?.windows.find((w) => w.window === window);
    if (!reading) {
      return {
        window,
        label,
        hasReading: false,
        value: 0,
        percent: 0,
        hot: false,
        reset: "",
        age: "",
      };
    }
    return {
      window,
      label,
      hasReading: true,
      value: reading.utilization ?? 0,
      percent: Math.round((reading.utilization ?? 0) * 100),
      hot: isHot(reading, quota?.pauseAt ?? null),
      reset: reading.resetsAt ? t("quota.resets", { time: formatTime(reading.resetsAt) }) : "",
      age: t("quota.read", { ago: formatAgo(now - Date.parse(reading.readAt), t) }),
    };
  });
}
