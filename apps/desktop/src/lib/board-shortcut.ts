import type { WorktreeFilter } from "./project-tree.ts";

type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

/** Where the board last opened on each host is kept, by host id (#669). */
const LAST_BOARDS_KEY = "flightdeck.lastBoards";

/** The board last opened on each host, by host id; a broken entry reads as nothing kept. */
export function loadLastBoards(storage: Storage): Record<string, string> {
  try {
    const kept: unknown = JSON.parse(storage.getItem(LAST_BOARDS_KEY) ?? "{}");
    if (kept === null || typeof kept !== "object" || Array.isArray(kept)) return {};
    return Object.fromEntries(
      Object.entries(kept).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

/** Keeps the board just opened on a host. */
export function saveLastBoard(storage: Storage, hostId: string, projectId: string): void {
  const kept = loadLastBoards(storage);
  if (kept[hostId] === projectId) return;
  storage.setItem(LAST_BOARDS_KEY, JSON.stringify({ ...kept, [hostId]: projectId }));
}

/**
 * The board the sidebar's Board item opens directly on a host (#669), or `null` for the landing:
 * the worktree picked in the project tree on this host, else the only project, else the board
 * last opened there while it is still a project of the host.
 */
export function boardShortcut(input: {
  hostId: string;
  projectIds: string[];
  worktree: WorktreeFilter | null;
  remembered: string | null;
}): string | null {
  const { hostId, projectIds, worktree, remembered } = input;
  if (worktree?.hostId === hostId && projectIds.includes(worktree.projectId))
    return worktree.projectId;
  if (projectIds.length === 1) return projectIds[0] ?? null;
  return remembered !== null && projectIds.includes(remembered) ? remembered : null;
}
