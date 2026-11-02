import { basename } from "./paths.ts";

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` of an instant in this machine's time zone. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The day `n` days after `day` (before, when negative). */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Every day from `from` to `to`, inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

export type Period = "today" | "7d" | "30d" | "month" | "range";

export const PERIODS: readonly Period[] = ["today", "7d", "30d", "month", "range"];

/** The days of a period ending today; `range` keeps the days the user chose. */
export function periodRange(
  period: Exclude<Period, "range">,
  today: string,
): { from: string; to: string } {
  const back = { today: 0, "7d": 6, "30d": 29 } as const;
  const from = period === "month" ? `${today.slice(0, 7)}-01` : addDays(today, -back[period]);
  return { from, to: today };
}

/** `US$ 1.23`. */
export const usd = (value: number) => `US$ ${value.toFixed(2)}`;

/** A project key as a person reads it: a folder's key (`host:alfa:C:\x\app`) shows as `app`. */
export function projectLabel(key: string): string {
  const folder = /^host:[^:]+:(.+)$/.exec(key)?.[1];
  return folder ? basename(folder) : key;
}

/**
 * The label of each project key, told apart when two read the same: the host when the hosts
 * differ (`docs-site · alfa`), else the parent folder (`b/docs-site`), both when neither is enough.
 */
export function projectLabels(keys: string[]): Map<string, string> {
  return new Map(keys.map((key) => [key, projectLabel(key)]));
}
