import { basename } from "@/shared/lib/index.ts";
import type { HubFilter, HubGroup, HubRow } from "./hub-row.ts";

const matches = (row: HubRow, filter: HubFilter) =>
  `${row.title}\n${row.cwd}\n${row.hostName}\n${groupName(row.projectKey)}`
    .toLowerCase()
    .includes(filter.text.trim().toLowerCase()) &&
  (!filter.origin || row.origin === filter.origin) &&
  (!filter.state || row.state === filter.state) &&
  (!filter.persona || row.persona?.id === filter.persona) &&
  (!filter.pinnedOnly || row.pinned) &&
  (filter.showArchived || !row.archived);

/** Repository name of a group: last path segment of the remote or of the folder. */
export const groupName = (key: string) => basename(key.replace(/^host:[^:]*:/, ""));

/** The order of a list of sessions: the ones that need you first, then pinned, standard names, latest activity. */
export function hubRowOrder(a: HubRow, b: HubRow): number {
  return (
    Number(b.state === "needs_you") - Number(a.state === "needs_you") ||
    Number(b.pinned) - Number(a.pinned) ||
    Number(b.standardName != null) - Number(a.standardName != null) ||
    (a.standardName ?? "").localeCompare(b.standardName ?? "", undefined, { numeric: true }) ||
    b.lastActivity.localeCompare(a.lastActivity)
  );
}

const isFolderKey = (key: string) => key.startsWith("host:");

/** The folder names that two folders of one host share: those never join, on any host. */
function ambiguousNames(rows: HubRow[]): Set<string> {
  const folders = new Map<string, Set<string>>();
  for (const { projectKey, hostName } of rows) {
    if (!isFolderKey(projectKey)) continue;
    const id = `${hostName}\n${groupName(projectKey)}`;
    folders.set(id, (folders.get(id) ?? new Set()).add(projectKey));
  }
  return new Set(
    [...folders].filter(([, keys]) => keys.size > 1).map(([id]) => id.split("\n")[1] as string),
  );
}

/**
 * What makes two rows one project. A key the daemon resolved (a remote) is shared by the hosts
 * already; a folder key (`host:<name>:<path>`) is per host, so the same folder name on two hosts
 * joins as one project, unless one host has two folders of that name.
 */
const mergeKey = (key: string, ambiguous: Set<string>) =>
  isFolderKey(key) && !ambiguous.has(groupName(key)) ? `folder:${groupName(key)}` : key;

/** The path above a project's name, `depth` segments of it: "work" for /home/a/work/api. */
function pathHint(key: string, depth: number): string {
  const path = key.replace(/^host:[^:]*:/, "");
  const parts = path.split(/[\\/]/).filter(Boolean);
  // A remote reads as owner and place: all of it above the name.
  if (!isFolderKey(key)) return parts.slice(0, -1).join("/");
  return parts.slice(Math.max(0, parts.length - 1 - depth), -1).join("/");
}

/** Groups that share a name say where they are, with as many path segments as it takes to differ. */
function withHints(groups: HubGroup[]): HubGroup[] {
  const byName = new Map<string, HubGroup[]>();
  for (const group of groups) byName.set(group.name, [...(byName.get(group.name) ?? []), group]);
  const hints = new Map<string, string>();
  for (const same of byName.values()) {
    if (same.length < 2) continue;
    let depth = 1;
    const at = () => same.map((g) => pathHint(g.key, depth));
    while (new Set(at()).size < same.length && depth < 8) depth++;
    const found = at();
    for (const [i, g] of same.entries()) hints.set(g.key, found[i] as string);
  }
  return groups.map((g) => (hints.has(g.key) ? { ...g, hint: hints.get(g.key) } : g));
}

/**
 * Filtered rows by project; the ones that need you first, then pinned, then the standard names
 * in order (phase 21: only hosts with names give them), then latest activity; groups by latest
 * activity.
 */
export function hubGroups(rows: HubRow[], filter: HubFilter): HubGroup[] {
  const byKey = new Map<string, HubRow[]>();
  const ambiguous = ambiguousNames(rows);
  for (const row of rows.filter((r) => matches(r, filter))) {
    const merged = mergeKey(row.projectKey, ambiguous);
    const list = byKey.get(merged);
    if (list) list.push(row);
    else byKey.set(merged, [row]);
  }
  return withHints(
    [...byKey.entries()]
      .map(([merged, list]) => {
        // The group's own key names a real project (the client scope reads it): the smallest
        // project key among the rows. The fold state is kept under the merged identity instead,
        // which a host going offline or a folder merging does not change.
        const keys = list.map((r) => r.projectKey);
        const key = keys.reduce((x, y) => (y < x ? y : x), keys[0] ?? "");
        return { key, foldKey: merged, name: groupName(key), rows: [...list].sort(hubRowOrder) };
      })
      .sort((a, b) => (b.rows[0]?.lastActivity ?? "").localeCompare(a.rows[0]?.lastActivity ?? "")),
  );
}
