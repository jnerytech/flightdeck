import { statfs } from "node:fs/promises";
import { type CommandResult, runCommand } from "../board/command.ts";
import { isInside } from "../paths.ts";
import { whichOnPath } from "../which.ts";
import type { FolderLocks } from "./locks.ts";
import { duSize, type WorktreeCard, type WorktreeProject, Worktrees } from "./worktrees.ts";

export interface WorktreesDeps {
  board: {
    listProjects(): WorktreeProject[];
    worktreeCards(projectId: string): WorktreeCard[];
    releaseWorktree(cardId: string, path: string, clearBranch: boolean): void;
    /** A card whose run is going or waiting: its folder is in use even before a session exists. */
    isActive(cardId: string): boolean;
  };
  /** The session manager: its list says which sessions still hold a folder. */
  sessions: { list(): Array<{ cwd: string; status: string }> };
  /** The run environments: a card whose setup or processes are going holds its folder. */
  runs: { state(cardId: string): { status: string } };
  /** The shells open on this host. */
  terminals: { list(): Array<{ cwd: string; exitCode: number | null }> };
  /** Claude sessions the user started outside Flightdeck. */
  externals: { list(): Array<{ cwd: string | null; status: string }> };
  /** The folders held by a removal; the starters check the same object. */
  locks: FolderLocks;
  /** How long one git command may take (default 60 s). */
  gitDeadlineMs?: number;
}

/** How long one folder may take to measure before its size is "unknown". */
const SIZE_DEADLINE_MS = 15_000;

/** How long one git command may take: a hung one must not hold the panel (and a folder) forever. */
const GIT_DEADLINE_MS = 60_000;

/** Statuses of a session that has no process any more. */
const GONE = new Set(["ended", "error"]);

/** Statuses of a card's run that have a process going. */
const LIVE_RUN = new Set(["setup", "running"]);

/**
 * One git command with a deadline. A command that ran out of time said nothing: it is never a
 * success, whatever code it was killed with.
 */
export async function gitWithin(
  cwd: string,
  args: string[],
  deadlineMs: number,
  run: typeof runCommand = runCommand,
): Promise<CommandResult> {
  const out = await run([whichOnPath("git") ?? "git", ...args], cwd, undefined, deadlineMs);
  return out.timedOut ? { ...out, code: out.code === 0 ? 124 : out.code } : out;
}

/** How long a git command may take: the remove has its own deadline (stub). */
export function gitDeadlineFor(_args: string[], deadlineMs: number): number {
  return deadlineMs;
}

/** The panel over the board's projects and cards, the live sessions, the runs and the machine's disk. */
export function createWorktrees(deps: WorktreesDeps): Worktrees {
  return new Worktrees({
    locks: deps.locks,
    projects: () => deps.board.listProjects(),
    cards: (projectId) => deps.board.worktreeCards(projectId),
    busy: (path, cardId) => {
      const inside = (cwd: string | null) => cwd !== null && isInside(path, cwd);
      if (
        deps.sessions.list().some((s) => !GONE.has(s.status) && inside(s.cwd)) ||
        deps.terminals.list().some((t) => t.exitCode === null && inside(t.cwd)) ||
        deps.externals.list().some((e) => e.status !== "ended" && inside(e.cwd))
      ) {
        return "live_session";
      }
      if (cardId === null) return null;
      return deps.board.isActive(cardId) || LIVE_RUN.has(deps.runs.state(cardId).status)
        ? "running"
        : null;
    },
    detach: (cardId, path, clearBranch) => {
      if (cardId !== null) deps.board.releaseWorktree(cardId, path, clearBranch);
    },
    git: (cwd, ...args) => gitWithin(cwd, args, deps.gitDeadlineMs ?? GIT_DEADLINE_MS),
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
