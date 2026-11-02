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
  const byLabel = new Map<string, string[]>();
  for (const key of keys)
    byLabel.set(projectLabel(key), [...(byLabel.get(projectLabel(key)) ?? []), key]);
  const labels = new Map<string, string>();
  for (const [label, group] of byLabel) {
    const told = group.length > 1 ? toldApart(label, group) : null;
    for (const key of group) labels.set(key, told?.get(key) ?? label);
  }
  return new Map(keys.map((key) => [key, labels.get(key) ?? key]));
}

const HOST_KEY = /^host:([^:]+):(.+)$/;

/** The first way of writing the keys of one clashing label that makes them all different. */
function toldApart(label: string, group: string[]): Map<string, string> {
  const parts = (key: string) => {
    const match = HOST_KEY.exec(key);
    const folder = match?.[2]?.split(/[\\/]/).filter(Boolean) ?? [];
    const parent = folder.length > 1 ? folder.at(-2) : undefined;
    return { host: match?.[1], parent };
  };
  const withHost = (key: string, base: string) => {
    const { host } = parts(key);
    return host ? `${base} · ${host}` : base;
  };
  const withParent = (key: string) => {
    const { parent } = parts(key);
    return parent ? `${parent}/${label}` : label;
  };
  const raw = (key: string) => key;
  const ways = [
    (key: string) => withHost(key, label),
    withParent,
    (key: string) => withHost(key, withParent(key)),
    raw,
  ];
  const way = ways.find((write) => new Set(group.map(write)).size === group.length) ?? raw;
  return new Map(group.map((key) => [key, way(key)]));
}
