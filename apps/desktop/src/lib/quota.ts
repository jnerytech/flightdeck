import type { AccountState, QuotaHistory, QuotaState, QuotaWindow } from "@flightdeck/protocol";
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

/** Hosts that share one Claude account: they share its quota, so they share a card. */
export interface QuotaGroup<H extends { id: string }> {
  key: string;
  hosts: H[];
}

/**
 * Groups the hosts by the Claude account they are signed in to (its email and organization), in
 * the order the hosts come. A host that is not signed in, or whose account is not known yet,
 * stays in a group of its own.
 */
export function quotaGroups<H extends { id: string }>(
  hosts: H[],
  account: Record<string, AccountState | undefined>,
): QuotaGroup<H>[] {
  const groups = new Map<string, QuotaGroup<H>>();
  for (const host of hosts) {
    const state = account[host.id];
    const key =
      state?.status === "signed_in" && state.name
        ? `${state.name}|${state.organization ?? ""}`
        : host.id;
    const group = groups.get(key);
    if (group) group.hosts.push(host);
    else groups.set(key, { key, hosts: [host] });
  }
  return [...groups.values()];
}
