import { z } from "zod";
import { readStored } from "@/shared/lib/index.ts";

/** The collapsible groups of the sidebar, in the order they show. */
export const SIDEBAR_GROUPS = [
  "work",
  "automation",
  "observability",
  "library",
  "machines",
] as const;
export type SidebarGroup = (typeof SIDEBAR_GROUPS)[number];

export const SIDEBAR_FOLDED_KEY = "flightdeck.sidebarFolded";

/** A stored list of group names; the group that held the hosts was called "infra" before it became Machines. */
const Names = z
  .array(z.unknown())
  .transform((stored) => stored.map((g) => (g === "infra" ? "machines" : g)));

/** The groups folded last time; anything unreadable is none. */
export function loadFolded(storage: { getItem(key: string): string | null }): SidebarGroup[] {
  const names = readStored(storage, SIDEBAR_FOLDED_KEY, Names, []);
  return SIDEBAR_GROUPS.filter((group) => names.includes(group));
}

export function saveFolded(
  storage: { setItem(key: string, value: string): void },
  folded: readonly SidebarGroup[],
): void {
  storage.setItem(SIDEBAR_FOLDED_KEY, JSON.stringify(folded));
}

/** The folded groups after the person clicks `group`'s header: a folded group opens, an open one folds. */
export function toggleGroup(folded: readonly SidebarGroup[], group: SidebarGroup): SidebarGroup[] {
  return folded.includes(group) ? folded.filter((g) => g !== group) : [...folded, group];
}
