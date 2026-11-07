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

/** The host choice that adds every host up (phase 29); a route can carry it too. */
export const ALL_HOSTS = "__all__";

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

const HOST_KEY = /^host:([^:]+):(.+)$/;
/** A path as the daemon writes it: from the root, a drive or a share. */
const ABSOLUTE = /^(\/|[A-Za-z]:[\\/]|\\\\)/;

/** The folder a project key names: a host key's folder, or a key that is itself a path. */
function folderOf(key: string): string | null {
  const folder = HOST_KEY.exec(key)?.[2];
  if (folder) return folder;
  return ABSOLUTE.test(key) ? key : null;
}

/** The names of the folders in a path, outermost first; the drive of `C:\\x` is not one. */
function folderNames(folder: string): string[] {
  return folder.split(/[\\/]/).filter((part) => part !== "" && !/^[A-Za-z]:$/.test(part));
}

/** The folder a project key names, whole, for the tooltip; `null` for a key that is no folder. */
export function projectPath(key: string): string | null {
  return folderOf(key);
}

/**
 * A project key as a person reads it: a folder's key (`host:alfa:C:\\x\\app`, or the path itself,
 * trailing slash and all) shows as its last folder, `app`. Anything else is its own label.
 */
export function projectLabel(key: string): string {
  const folder = folderOf(key);
  return (folder === null ? undefined : folderNames(folder).at(-1)) ?? key;
}

/**
 * The label of each of `keys`, told apart when two read the same: the host when the hosts
 * differ (`docs-site · alfa`), else the parent folder (`b/docs-site`), both when neither is enough.
 * `known` are the other keys to be told apart from: the same ones give the same label on any screen.
 */
export function projectLabels(keys: string[], known: readonly string[] = []): Map<string, string> {
  // A name is told apart against every key the app knows, not only the ones on this screen, so one
  // project reads the same everywhere (issue #881).
  const byLabel = new Map<string, string[]>();
  for (const key of new Set([...known, ...keys]))
    byLabel.set(projectLabel(key), [...(byLabel.get(projectLabel(key)) ?? []), key]);
  const labels = new Map<string, string>();
  for (const [label, group] of byLabel) {
    const told = group.length > 1 ? toldApart(label, group) : null;
    for (const key of group) labels.set(key, told?.get(key) ?? label);
  }
  return new Map(keys.map((key) => [key, labels.get(key) ?? key]));
}

/** The first way of writing the keys of one clashing label that makes them all different. */
function toldApart(label: string, group: string[]): Map<string, string> {
  const hostOf = (key: string) => HOST_KEY.exec(key)?.[1];
  const names = new Map(group.map((key) => [key, folderNames(folderOf(key) ?? "")]));
  // The last `n + 1` folders of a key, as many as it has.
  const tail = (key: string, n: number) =>
    (names.get(key) ?? []).slice(-(n + 1)).join("/") || label;
  // Each key takes the fewest folders that no other key shares: one level, further only where
  // that level still clashes.
  const withFolders = (key: string) => {
    const most = Math.max(...group.map((one) => names.get(one)?.length ?? 0));
    for (let n = 0; n < most; n++) {
      if (group.every((one) => one === key || tail(one, n) !== tail(key, n))) return tail(key, n);
    }
    return tail(key, most);
  };
  const withHost = (key: string, base: string) => {
    const host = hostOf(key);
    return host ? `${base} · ${host}` : base;
  };
  const raw = (key: string) => key;
  const ways = [
    (key: string) => withHost(key, label),
    withFolders,
    (key: string) => withHost(key, withFolders(key)),
    raw,
  ];
  const way = ways.find((write) => new Set(group.map(write)).size === group.length) ?? raw;
  return new Map(group.map((key) => [key, way(key)]));
}
