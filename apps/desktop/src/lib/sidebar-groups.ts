/** The collapsible groups of the sidebar, in the order they show. */
export const SIDEBAR_GROUPS = ["work", "library", "infra"] as const;
export type SidebarGroup = (typeof SIDEBAR_GROUPS)[number];

export const SIDEBAR_FOLDED_KEY = "flightdeck.sidebarFolded";

/** The groups folded last time; anything unreadable is none. */
export function loadFolded(_storage: { getItem(key: string): string | null }): SidebarGroup[] {
  return [];
}

export function saveFolded(
  _storage: { setItem(key: string, value: string): void },
  _folded: readonly SidebarGroup[],
): void {}
