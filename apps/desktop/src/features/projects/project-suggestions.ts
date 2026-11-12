import { isInside } from "@/shared/lib/index.ts";

const MOST = 5;

/** Worktrees of a card (the daemon's) or of an agent (Claude Code's): never a project to add (#1544). */
const WORKTREE_FOLDERS = ["/.flightdeck/worktrees/", "/.claude/worktrees/"]; // NOSONAR: names of folders to leave out, never a path this code reads or writes

function inWorktree(cwd: string): boolean {
  const path = `${cwd.toLowerCase().replaceAll("\\", "/")}/`;
  return WORKTREE_FOLDERS.some((part) => path.includes(part));
}

/**
 * The folders worth offering as a new project: where the host's recent sessions ran, inside its
 * allowed folders, not already a project nor a worktree; newest first, each once.
 */
export function suggestFolders(
  sessions: ReadonlyArray<{ cwd: string; updatedAt: string }>,
  roots: readonly string[],
  projects: ReadonlyArray<{ path: string }>,
): string[] {
  const seen: string[] = [];
  const newestFirst = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const { cwd } of newestFirst) {
    if (inWorktree(cwd) || !roots.some((root) => isInside(cwd, root))) continue;
    if (projects.some((p) => isInside(cwd, p.path) && isInside(p.path, cwd))) continue;
    if (seen.some((s) => isInside(cwd, s) && isInside(s, cwd))) continue;
    seen.push(cwd);
  }
  return seen.slice(0, MOST);
}
