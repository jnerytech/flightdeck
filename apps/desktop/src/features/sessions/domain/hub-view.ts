import { type HubFilter, type HubGroup, type HubRow, isOver } from "./hub-row.ts";

/** How many rows the hub draws before "show more": the DOM of 9,000 sessions is not worth drawing. */
export const HUB_ROW_CAP = 200;

/** A project group as the screen draws it: folded, with its history behind a count. */
export interface HubGroupView {
  group: HubGroup;
  /** Live and needs-you sessions, in the group's order. */
  live: HubRow[];
  /** How many sessions the project has in all (the live ones are `live.length`). */
  total: number;
  /** Sessions that ended or come from the history, newest first. */
  earlier: HubRow[];
  expanded: boolean;
  earlierShown: boolean;
  /** What is drawn: nothing when folded, else the live ones and, when asked for, the earlier ones. */
  rows: HubRow[];
}

/**
 * Each group as drawn. A group is open when the person said so, else when a search is on, and
 * folded it shows only the sessions that need you; its earlier sessions come behind a count unless asked for (or searching).
 */
export function hubView(
  groups: HubGroup[],
  open: Record<string, boolean | undefined>,
  earlierOpen: Record<string, boolean | undefined>,
  searching: boolean,
): HubGroupView[] {
  return groups.map((group) => {
    // A pinned session is one the person wants close: it stays with the live ones.
    const isEarlier = (r: HubRow) => !r.pinned && (r.origin === "history" || isOver(r.state));
    const earlier = group.rows
      .filter(isEarlier)
      .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
    const live = group.rows.filter((r) => !isEarlier(r));
    // Every project starts folded (the list gets long); a search or filter opens what it keeps.
    // Kept under the stable key; a choice made under the project's old key still counts.
    const expanded = open[group.foldKey] ?? open[group.key] ?? searching;
    const earlierShown =
      searching || (earlierOpen[group.foldKey] ?? earlierOpen[group.key]) === true;
    return {
      group,
      live,
      total: group.rows.length,
      earlier,
      expanded,
      earlierShown,
      // Folded, the sessions that need you stay in view: they are the reason to look.
      rows: expanded
        ? [...live, ...(earlierShown ? earlier : [])]
        : live.filter((r) => r.state === "needs_you"),
    };
  });
}

/**
 * Whether the filter narrows the list on purpose, so what it keeps is shown, not folded away. A
 * Hosts chip only chooses whose sessions the list is about: the projects stay as they were.
 */
export function isSearching(filter: HubFilter): boolean {
  return (
    filter.text.trim() !== "" ||
    filter.origin !== "" ||
    filter.state !== "" ||
    filter.persona !== "" ||
    filter.pinnedOnly
  );
}

/** The groups cut to their first `limit` rows in display order, and how many rows were left out. */
export function capGroups(
  groups: HubGroup[],
  limit: number,
): { groups: HubGroup[]; hidden: number } {
  let left = limit;
  const kept: HubGroup[] = [];
  for (const group of groups) {
    // A project folded to nothing costs no rows: its header stays whatever the cap has left.
    if (group.rows.length === 0) kept.push(group);
    else if (left > 0) {
      kept.push(group.rows.length <= left ? group : { ...group, rows: group.rows.slice(0, left) });
      left -= group.rows.length;
    }
  }
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  return { groups: kept, hidden: Math.max(0, total - limit) };
}

/** How many of a project's rows are active: the ones that have not ended or failed (#1132). */
export function activeCount(rows: HubRow[]): number {
  return rows.filter((r) => !isOver(r.state)).length;
}
