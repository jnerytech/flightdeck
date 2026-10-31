import type { Database } from "bun:sqlite";
import type { Board } from "../board/board.ts";
import type { FixRound, PrFixer } from "./fix.ts";

/** One session that worked on a card, for the trail of its PR (phase 22). */
export interface TraceSession {
  sessionId: string;
  claudeSessionId: string | null;
  name: string | null;
  /** `fix` for a round of fixing the PR, `run` for the card's own runs. */
  kind: "run" | "fix";
  startedAt: string;
  costUsd: number | null;
  /** How many checkpoints (phase 12) its Claude session has to go back to. */
  checkpoints: number;
}

/** The trail from a card and its PR to the sessions, the cost, the rounds and the work item. */
export interface CardTrace {
  cardId: string;
  title: string;
  prUrl: string | null;
  /** `AB#id` or an issue reference (phase 13). */
  workItem: string | null;
  sessions: TraceSession[];
  rounds: FixRound[];
  costUsd: number | null;
}

/** Where a PR link leads: its card, or the old sessions whose history mentions it. */
export interface UrlTrace {
  via: "card" | "history" | "none";
  trace: CardTrace | null;
  sessions: Array<{ claudeSessionId: string; title: string | null; cwd: string }>;
}

export interface TracesOptions {
  db: Database;
  board: Pick<Board, "getCard">;
  fixer: Pick<PrFixer, "rounds">;
  /** The Claude session id of a managed session. */
  claudeSessionOf: (sessionId: string) => string | null;
  /** Name and request of a managed session, for the lists and the PR description. */
  describeSession: (sessionId: string) => { name: string | null; request: string | null };
  /** Estimated cost by Claude session id (phase 8). */
  sessionCosts: (claudeSessionIds: string[]) => Record<string, number>;
  cardCost: (cardId: string) => number | null;
  checkpoints: (claudeSessionId: string) => number;
  /** The history index (phase 5): the sessions whose text has the query. */
  search: (query: string) => Array<{ claudeSessionId: string; title: string | null; cwd: string }>;
}

export class Traces {
  constructor(_opts: TracesOptions) {}

  trace(cardId: string): CardTrace {
    return {
      cardId,
      title: "",
      prUrl: null,
      workItem: null,
      sessions: [],
      rounds: [],
      costUsd: null,
    };
  }

  /** What a pasted PR link opens. */
  byUrl(_url: string): UrlTrace {
    return { via: "none", trace: null, sessions: [] };
  }

  /** The PR's description, from what the card's sessions did. */
  describe(_cardId: string): string {
    return "";
  }
}
