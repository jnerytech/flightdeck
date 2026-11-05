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
  /** The session manager: its list says which sessions still hold a folder. */
  sessions: { list(): Array<{ cwd: string; status: string }> };
  /** The run environments: a card whose setup or processes are going holds its folder. */
  runs: { state(cardId: string): { status: string } };
}

/** How long one folder may take to measure before its size is "unknown". */
const SIZE_DEADLINE_MS = 15_000;

/** Statuses of a session that has no process any more. */
const GONE = new Set(["ended", "error"]);

/** Statuses of a card's run that have a process going. */
const LIVE_RUN = new Set(["setup", "running"]);

/** The panel over the board's projects and cards, the live sessions, the runs and the machine's disk. */
export function createWorktrees(deps: WorktreesDeps): Worktrees {
  return new Worktrees({
    projects: () => deps.board.listProjects(),
    cards: (projectId) => deps.board.worktreeCards(projectId),
    busy: (path, cardId) => {
      if (deps.sessions.list().some((s) => !GONE.has(s.status) && isInside(path, s.cwd))) {
        return "live_session";
      }
      return cardId !== null && LIVE_RUN.has(deps.runs.state(cardId).status) ? "running" : null;
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
