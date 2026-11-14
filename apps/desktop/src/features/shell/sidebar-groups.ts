import type { SidebarGroup } from "@/features/viewprefs/index.ts";

/** The folded groups after the person clicks `group`'s header: a folded group opens, an open one folds. */
export function toggleGroup(folded: readonly SidebarGroup[], group: SidebarGroup): SidebarGroup[] {
  return folded.includes(group) ? folded.filter((g) => g !== group) : [...folded, group];
}
