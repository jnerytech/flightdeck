import type { TreeNode, TreeProject, WorktreeFilter } from "./project-tree.ts";

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

/** Projects the tree lists before "All projects (N)" holds the rest. */
export const PROJECT_CAP = 5;

/** With more projects than this, all but the active one start folded. */
export const FOLD_ABOVE = 3;

export const TREE_OPENED_KEY = "flightdeck.treeOpened";
export const TREE_PINNED_KEY = "flightdeck.treePinned";

/** The projects the person unfolded last time, against the default fold. */
export function loadTreeOpened(_storage: { getItem(key: string): string | null }): string[] {
  return ["?"];
}

export function saveTreeOpened(
  _storage: { setItem(key: string, value: string): void },
  _opened: readonly string[],
): void {}

/** The projects the person pinned (`hostId/projectId`) on this computer. */
export function loadTreePinned(_storage: { getItem(key: string): string | null }): string[] {
  return ["?"];
}

export function saveTreePinned(
  _storage: { setItem(key: string, value: string): void },
  _pinned: readonly string[],
): void {}

/** The key a project goes by in the stored lists. */
export const projectKey = (project: Pick<TreeProject, "hostId" | "projectId">) =>
  `${project.hostId}/${project.projectId}`;

/**
 * The projects the tree draws: with no name typed, at most `PROJECT_CAP` (the pinned first, then
 * the most recently active) and always the picked one; with a name typed, every match.
 */
export function shownProjects(
  _tree: TreeProject[],
  _pinned: readonly string[],
  _query: string,
  _picked: string | null,
): TreeProject[] {
  return [];
}

/** Whether a project starts folded: with more than `FOLD_ABOVE` projects, all but the active one. */
export function foldedByDefault(_total: number, _key: string, _active: string | null): boolean {
  return false;
}

/** The tone that earns a folded project its dot: a needs-you first, then running, else none. */
export function liveTone(_project: TreeProject): "needs-you" | "running" | null {
  return null;
}
