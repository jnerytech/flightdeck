import type { Card, Project } from "@flightdeck/protocol";
import type { StateTone } from "@/components/status/status-dot";
import type { AppState } from "./app-store.ts";
import type { HubRow } from "./hub.ts";
import { isInside } from "./paths.ts";
import { statusTone } from "./status.ts";

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

const BY_PRIORITY: Array<"needs-you" | "running" | "idle"> = ["needs-you", "running", "idle"];

/** The tone of the live sessions in a folder: the one that needs you wins, then running, else idle. */
function folderTone(
  rows: HubRow[],
  hostId: string,
  path: string,
  apart: readonly string[],
): StateTone {
  const here = rows.filter(
    (row) =>
      row.hostId === hostId &&
      !row.archived &&
      isInside(row.cwd, path) &&
      !apart.some((other) => isInside(row.cwd, other)),
  );
  const tones = new Set(
    here.map((r) =>
      r.state === "needs_you" ? "needs-you" : r.state === "running" ? "running" : "idle",
    ),
  );
  return BY_PRIORITY.find((tone) => tones.has(tone)) ?? "idle";
}

/**
 * The projects of the online hosts with their checkouts: the main one first (the base branch, the
 * tone of the live sessions in the project's folder), then one per card that has a worktree.
 */
export function projectTree(
  state: Pick<AppState, "hosts" | "projects" | "cards">,
  rows: HubRow[],
): TreeProject[] {
  return state.hosts
    .filter((host) => host.status === "online")
    .flatMap((host) =>
      (state.projects[host.id] ?? []).map((project): TreeProject => {
        const cards = Object.entries(state.cards)
          .filter(([key, card]) => key.startsWith(`${host.id}/`) && card.projectId === project.id)
          .map(([, card]) => card)
          .filter((card) => card.worktreePath)
          .sort((a, b) => (a.branch ?? "").localeCompare(b.branch ?? ""));
        const worktrees = cards.map((card) => card.worktreePath as string);
        return {
          hostId: host.id,
          projectId: project.id,
          name: project.name,
          path: project.path,
          nodes: [
            {
              key: `${host.id}/${project.id}/primary`,
              kind: "primary",
              branch: project.baseBranch,
              base: project.baseBranch,
              path: project.path,
              tone: folderTone(rows, host.id, project.path, worktrees),
              cardId: null,
            },
            ...cards.map(
              (card): TreeNode => ({
                key: `${host.id}/${project.id}/${card.id}`,
                kind: "worktree",
                branch: card.branch ?? card.title,
                base: project.baseBranch,
                path: card.worktreePath as string,
                tone: card.sessionStatus ? statusTone(card.sessionStatus) : "idle",
                cardId: card.id,
              }),
            ),
          ],
        };
      }),
    );
}

/** A worktree keeps its card; the main checkout keeps the cards that have none. */
export function cardInFilter(card: Card, filter: WorktreeFilter): boolean {
  return filter.kind === "worktree" ? card.worktreePath === filter.path : !card.worktreePath;
}

/**
 * A worktree keeps the sessions inside it; the main checkout keeps the ones in the project's
 * folder that are outside every worktree.
 */
export function rowInFilter(
  row: HubRow,
  filter: WorktreeFilter,
  project: Pick<Project, "path">,
  worktrees: readonly string[],
): boolean {
  if (row.hostId !== filter.hostId) return false;
  if (filter.kind === "worktree") return isInside(row.cwd, filter.path);
  return isInside(row.cwd, project.path) && !worktrees.some((path) => isInside(row.cwd, path));
}
