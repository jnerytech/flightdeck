import type {
  BoardColumn,
  PrState,
  WorktreeRemoveResult,
  WorktreesResult,
} from "@flightdeck/protocol";
import type { CommandResult } from "../board/command.ts";

export interface WorktreeProject {
  id: string;
  name: string;
  path: string;
  baseBranch: string;
}

export interface WorktreeCard {
  id: string;
  title: string;
  column: BoardColumn;
  worktreePath: string | null;
  updatedAt: string;
  prState: PrState | null;
}

export interface WorktreesOptions {
  projects(): WorktreeProject[];
  cards(projectId: string): WorktreeCard[];
  /** Whether anything runs in that folder: a live session, or a process of the card's run. */
  busy(path: string, cardId: string | null): "live_session" | "running" | null;
  /** The card no longer has this worktree. */
  detach(cardId: string): void;
  git(repo: string, ...args: string[]): Promise<CommandResult>;
  /** Bytes under `path`; null when it could not be told in time. */
  size(path: string): Promise<number | null>;
  disk(path: string): Promise<{ totalBytes: number; freeBytes: number } | null>;
  now(): number;
}

/** Stub: wrong values until the area is green. */
export class Worktrees {
  constructor(_opts: WorktreesOptions) {}

  async list(_projectId?: string): Promise<WorktreesResult> {
    return { worktrees: [], disks: [] };
  }

  async remove(_items: Array<{ projectId: string; path: string }>): Promise<WorktreeRemoveResult> {
    return { removed: [], kept: [] };
  }
}

/** Stub. */
export async function duSize(
  _path: string,
  _timeoutMs: number,
  _run: (cmd: string[], cwd: string, timeoutMs: number) => Promise<CommandResult>,
): Promise<number | null> {
  return 0;
}
