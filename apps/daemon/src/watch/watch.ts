import type { Database } from "bun:sqlite";
import type { Board } from "../board/board.ts";
import type { PrCheck, PrComment, PrProvider } from "../board/pr.ts";
import type { PrProviderKind } from "../board/types.ts";

/** What a watched PR needs fixed: the reason a round of fixing starts (phase 22). */
export interface WatchTrigger {
  cardId: string;
  /** The builds that are failing now and were not failing at the last look. */
  failed: PrCheck[];
  /** The PR conflicts with its target and did not at the last look. */
  conflicts: boolean;
  /** Review comments of people you trust, that were not there at the last look. */
  comments: PrComment[];
}

export interface WatchSettings {
  enabled: boolean;
  /** Rounds of fixing per PR. */
  maxRounds: number;
  /** Commands that must pass in the card's worktree before anything is pushed. */
  checks: string[];
  /** Estimated cost of the rounds of a PR, in US$; `null` for no limit. */
  budgetUsd: number | null;
  /** Turns of the rounds of a PR; `null` for no limit. */
  maxTurns: number | null;
  /** The persona the fixing session runs in. */
  persona: string;
}

export interface PrWatcherOptions {
  db: Database;
  board: Pick<Board, "getCard" | "getProject">;
  /** The PR host of a kind of project; the real CLIs when absent (the tests' fakes win on PATH). */
  provider?: (kind: PrProviderKind) => PrProvider | null;
  /** Called once for each time a PR got worse. */
  onTrigger?: (trigger: WatchTrigger) => void | Promise<void>;
}

/** Watches the open PRs of cards: reads their builds, conflicts and comments each round. */
export class PrWatcher {
  constructor(_opts: PrWatcherOptions) {}

  settings(_projectId: string): WatchSettings {
    return {
      enabled: true,
      maxRounds: 0,
      checks: [],
      budgetUsd: null,
      maxTurns: null,
      persona: "",
    };
  }

  setSettings(_projectId: string, _patch: Partial<WatchSettings>): WatchSettings {
    return this.settings(_projectId);
  }

  /** Whether the card's PR is watched: its own choice, else the project's default. */
  enabled(_cardId: string): boolean {
    return true;
  }

  setEnabled(_cardId: string, _enabled: boolean | null): void {}

  /** One round: looks at every watched card with an open PR. */
  async tick(): Promise<void> {}
}
