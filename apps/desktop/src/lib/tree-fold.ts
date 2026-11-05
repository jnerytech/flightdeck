import type { TreeNode, WorktreeFilter } from "./project-tree.ts";

/** Checkouts a project lists before the rest wait behind "N more". */
export const TREE_CAP = 8;

export const TREE_FOLDED_KEY = "flightdeck.treeFolded";

/** The projects folded last time (`hostId/projectId`); anything unreadable is none. */
export function loadTreeFolded(storage: { getItem(key: string): string | null }): string[] {
  try {
    const stored = JSON.parse(storage.getItem(TREE_FOLDED_KEY) ?? "[]") as unknown;
    return Array.isArray(stored)
      ? stored.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    return [];
  }
}

export function saveTreeFolded(
  storage: { setItem(key: string, value: string): void },
  folded: readonly string[],
): void {
  storage.setItem(TREE_FOLDED_KEY, JSON.stringify(folded));
}

/**
 * The checkouts a project draws: the first `TREE_CAP` unless the person opened the rest, and always
 * the one that is picked, so a pick never disappears behind "N more".
 */
export function visibleNodes(
  nodes: TreeNode[],
  expanded: boolean,
  picked: (node: TreeNode) => boolean,
): TreeNode[] {
  if (expanded || nodes.length <= TREE_CAP) return nodes;
  return nodes.filter((node, index) => index < TREE_CAP || picked(node));
}

/** Whether `filter` points at a checkout of that project. */
export function pickedIn(
  filter: WorktreeFilter | null,
  hostId: string,
  projectId: string,
): WorktreeFilter | null {
  return filter && filter.hostId === hostId && filter.projectId === projectId ? filter : null;
}
