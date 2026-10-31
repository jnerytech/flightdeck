import type { Database } from "bun:sqlite";
import type { Board } from "../board/board.ts";
import type { CommandResult } from "../board/command.ts";
import type { PrProvider } from "../board/pr.ts";
import type { PrProviderKind } from "../board/types.ts";
import type { CheckRunner } from "../workflows/check-runner.ts";
import type { PrWatcher, WatchTrigger } from "./watch.ts";

/** One round of fixing a PR, as it is kept and shown (phase 22). */
export interface FixRound {
  id: string;
  cardId: string;
  n: number;
  status: "running" | "pushed" | "failed" | "stopped";
  /** What started it: the failed checks, the conflict, the comments. */
  trigger: { failed: string[]; conflicts: boolean; comments: string[] };
  summary: string | null;
  sessionId: string | null;
  costUsd: number;
  turns: number;
  startedAt: string;
  endedAt: string | null;
}

export interface PrFixerOptions {
  db: Database;
  board: Pick<Board, "getCard" | "getProject" | "fixCard">;
  watcher: PrWatcher;
  provider?: (kind: PrProviderKind) => PrProvider | null;
  /** Runs the project's local checks in the card's worktree. */
  checks: CheckRunner;
  /** `git` in a folder; the real one when absent (tests record the calls). */
  git?: (cwd: string, ...args: string[]) => Promise<CommandResult>;
  /** Told when a card's watch changes (a round ended, or the card needs you). */
  onUpdate?: (cardId: string) => void;
  clock?: () => number;
}

/** Runs the rounds of fixing a watched PR, inside their limits. */
export class PrFixer {
  constructor(_opts: PrFixerOptions) {}

  /** The watcher's trigger: starts a round, one at a time per card, unless a limit says stop. */
  async onTrigger(_trigger: WatchTrigger): Promise<void> {}

  /** Settles when no round is running. */
  async idle(): Promise<void> {}

  rounds(_cardId: string): FixRound[] {
    return [];
  }
}
