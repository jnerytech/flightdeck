import { statfs } from "node:fs/promises";
import { git, runCommand } from "../board/command.ts";
import { isInside } from "../paths.ts";
import { duSize, type WorktreeCard, type WorktreeProject, Worktrees } from "./worktrees.ts";

export interface WorktreesDeps {
  board: {
    listProjects(): WorktreeProject[];
    worktreeCards(projectId: string): WorktreeCard[];
    releaseWorktree(cardId: string): void;
  };
  sessions(): Array<{ cwd: string; status: string }>;
  runLive(cardId: string): boolean;
}

/** How long one folder may take to measure before its size is "unknown". */
const SIZE_DEADLINE_MS = 15_000;

/** Statuses of a session that has no process any more. */
const GONE = new Set(["ended", "error"]);

/** The panel over the board's projects and cards, the live sessions, the runs and the machine's disk. */
export function createWorktrees(deps: WorktreesDeps): Worktrees {
  return new Worktrees({
    projects: () => deps.board.listProjects(),
    cards: (projectId) => deps.board.worktreeCards(projectId),
    busy: (path, cardId) => {
      if (deps.sessions().some((s) => !GONE.has(s.status) && isInside(path, s.cwd))) {
        return "live_session";
      }
      return cardId !== null && deps.runLive(cardId) ? "running" : null;
    },
    detach: (cardId) => deps.board.releaseWorktree(cardId),
    git: (cwd, ...args) => git(cwd, ...args),
    size: (path) =>
      duSize(path, SIZE_DEADLINE_MS, (cmd, cwd, timeoutMs) =>
        runCommand(cmd, cwd, undefined, timeoutMs),
      ),
    disk: async (path) => {
      try {
        const { blocks, bsize, bavail } = await statfs(path);
        return { totalBytes: blocks * bsize, freeBytes: bavail * bsize };
      } catch {
        return null;
      }
    },
    now: () => Date.now(),
  });
}
