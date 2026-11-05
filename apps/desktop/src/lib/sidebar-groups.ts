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

/** The groups folded last time; anything unreadable is none. */
export function loadFolded(storage: { getItem(key: string): string | null }): SidebarGroup[] {
  try {
    const stored = JSON.parse(storage.getItem(SIDEBAR_FOLDED_KEY) ?? "[]") as unknown;
    // The group that held the hosts was called "infra" before it became Machines.
    const names = Array.isArray(stored) ? stored.map((g) => (g === "infra" ? "machines" : g)) : [];
    return SIDEBAR_GROUPS.filter((group) => names.includes(group));
  } catch {
    return [];
  }
}

export function saveFolded(
  storage: { setItem(key: string, value: string): void },
  folded: readonly SidebarGroup[],
): void {
  storage.setItem(SIDEBAR_FOLDED_KEY, JSON.stringify(folded));
}
