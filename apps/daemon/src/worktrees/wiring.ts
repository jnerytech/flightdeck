import type { WorktreeCard, WorktreeProject } from "./worktrees.ts";
import { Worktrees } from "./worktrees.ts";

export interface WorktreesDeps {
  board: {
    listProjects(): WorktreeProject[];
    worktreeCards(projectId: string): WorktreeCard[];
    releaseWorktree(cardId: string): void;
  };
  sessions(): Array<{ cwd: string; status: string }>;
  runLive(cardId: string): boolean;
}

/** Stub: wrong values until the area is green. */
export function createWorktrees(_deps: WorktreesDeps): Worktrees {
  return new Worktrees({
    projects: () => [],
    cards: () => [],
    busy: () => null,
    detach: () => {},
    git: async () => ({ code: 1, stdout: "", stderr: "" }),
    size: async () => null,
    disk: async () => null,
    now: () => 0,
  });
}
