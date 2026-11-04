import type { Card, Project } from "@flightdeck/protocol";
import type { StateTone } from "@/components/status/status-dot";
import type { AppState } from "./app-store.ts";
import type { HubRow } from "./hub.ts";

/** One line under a project in the sidebar: its main checkout or one card's worktree. */
export interface TreeNode {
  key: string;
  kind: "primary" | "worktree";
  branch: string;
  /** The branch it was cut from. */
  base: string;
  path: string;
  tone: StateTone;
  cardId: string | null;
}

export interface TreeProject {
  hostId: string;
  projectId: string;
  name: string;
  path: string;
  nodes: TreeNode[];
}

/** The node the person picked: it narrows the board and the Sessions list to that checkout. */
export interface WorktreeFilter {
  hostId: string;
  projectId: string;
  kind: "primary" | "worktree";
  path: string;
  branch: string;
}

/** Stubbed until the test commit is in. */
export function projectTree(
  _state: Pick<AppState, "hosts" | "projects" | "cards">,
  _rows: HubRow[],
): TreeProject[] {
  return [];
}

/** Stubbed until the test commit is in. */
export function cardInFilter(_card: Card, _filter: WorktreeFilter): boolean {
  return true;
}

/** Stubbed until the test commit is in. */
export function rowInFilter(
  _row: HubRow,
  _filter: WorktreeFilter,
  _project: Pick<Project, "path">,
  _worktrees: readonly string[],
): boolean {
  return true;
}
