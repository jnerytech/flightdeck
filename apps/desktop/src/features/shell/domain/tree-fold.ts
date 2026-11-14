import type { TreeNode, TreeProject, WorktreeFilter } from "@/features/projects/index.ts";

/** Checkouts a project lists before the rest wait behind "N more". */
export const TREE_CAP = 8;

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
  return filter?.hostId === hostId && filter.projectId === projectId ? filter : null;
}

/** Projects the tree lists before "All projects (N)" holds the rest. */
export const PROJECT_CAP = 5;

/** With more projects than this, all but the active one start folded. */
export const FOLD_ABOVE = 3;

/** The key a project goes by in the stored lists. */
export const projectKey = (project: Pick<TreeProject, "hostId" | "projectId">) =>
  `${project.hostId}/${project.projectId}`;

/** Most recent first; the quiet ones, and ties, by name. */
const byRecency = (a: TreeProject, b: TreeProject) =>
  (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0) || a.name.localeCompare(b.name);

/**
 * The projects the tree draws: with no name typed, at most `PROJECT_CAP` (the pinned first, then
 * the most recently active) and always the picked one; with a name typed, every match.
 */
export function shownProjects(
  tree: TreeProject[],
  pinned: readonly string[],
  query: string,
  picked: string | null,
): TreeProject[] {
  const isPinned = (project: TreeProject) => pinned.includes(projectKey(project));
  const order = (a: TreeProject, b: TreeProject) =>
    Number(isPinned(b)) - Number(isPinned(a)) || byRecency(a, b);
  const text = query.trim().toLowerCase();
  if (text !== "") {
    return tree.filter((project) => project.name.toLowerCase().includes(text)).sort(order);
  }
  const sorted = [...tree].sort(order);
  const top = sorted.slice(0, PROJECT_CAP);
  const extra = sorted.find((project) => projectKey(project) === picked);
  return extra && !top.includes(extra) ? [...top, extra] : top;
}

/** Whether a project starts folded: with more than `FOLD_ABOVE` projects, all but the active one. */
export function foldedByDefault(total: number, key: string, active: string | null): boolean {
  return total > FOLD_ABOVE && key !== active;
}

/** The tone that earns a folded project its dot: a needs-you first, then running, else none. */
export function liveTone(project: TreeProject): "needs-you" | "running" | null {
  const tones = new Set(project.nodes.map((node) => node.tone));
  if (tones.has("needs-you")) return "needs-you";
  return tones.has("running") ? "running" : null;
}
