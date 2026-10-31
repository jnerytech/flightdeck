import type { Database } from "bun:sqlite";
import type { Board } from "../board/board.ts";
import { closingLine } from "../issues/providers.ts";
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

interface RunRow {
  session_id: string;
  fix_prompt: string | null;
  queued_at: string;
  started_at: string | null;
}

/** A PR link without what the page adds to it: the query, the fragment, the slash at the end. */
const plain = (url: string) => (url.split(/[?#]/)[0] ?? "").replace(/\/+$/, "");

const firstLine = (text: string | null, limit = 200) => {
  const line = (text ?? "").trim().split(/\r?\n/)[0] ?? "";
  return line.length > limit ? `${line.slice(0, limit)} […]` : line;
};

export class Traces {
  constructor(private readonly opts: TracesOptions) {}

  trace(cardId: string): CardTrace {
    const { opts } = this;
    const card = opts.board.getCard(cardId);
    const runs = opts.db
      .query<RunRow, [string]>(
        `SELECT session_id, fix_prompt, queued_at, started_at FROM card_runs
         WHERE card_id = ? AND session_id IS NOT NULL ORDER BY queued_at, rowid`,
      )
      .all(cardId);
    const claude = runs.map((run) => opts.claudeSessionOf(run.session_id));
    const costs = opts.sessionCosts(claude.filter((id): id is string => id !== null));
    return {
      cardId,
      title: card.title,
      prUrl: card.prUrl,
      workItem: card.issueRef,
      sessions: runs.map((run, i): TraceSession => {
        const claudeSessionId = claude[i] ?? null;
        return {
          sessionId: run.session_id,
          claudeSessionId,
          name: opts.describeSession(run.session_id).name,
          kind: run.fix_prompt === null ? "run" : "fix",
          startedAt: run.started_at ?? run.queued_at,
          costUsd: claudeSessionId === null ? null : (costs[claudeSessionId] ?? null),
          checkpoints: claudeSessionId === null ? 0 : opts.checkpoints(claudeSessionId),
        };
      }),
      rounds: opts.fixer.rounds(cardId),
      costUsd: opts.cardCost(cardId),
    };
  }

  /** What a pasted PR link opens: its card, else the old sessions whose history names it. */
  byUrl(url: string): UrlTrace {
    const link = plain(url);
    const card = this.opts.db
      .query<{ id: string; pr_url: string }, []>(
        "SELECT id, pr_url FROM cards WHERE pr_url IS NOT NULL",
      )
      .all()
      .find((row) => plain(row.pr_url) === link);
    if (card) return { via: "card", trace: this.trace(card.id), sessions: [] };
    const sessions = this.opts.search(link);
    return { via: sessions.length > 0 ? "history" : "none", trace: null, sessions };
  }

  /**
   * The PR's description, from what the card's sessions did: the card's text, the sessions, the
   * rounds of fixing and the line that links the work item.
   */
  describe(cardId: string): string {
    const trace = this.trace(cardId);
    const card = this.opts.board.getCard(cardId);
    const worked = trace.sessions
      .filter((s) => s.kind === "run")
      .map(
        (s) =>
          `- ${s.name ?? s.sessionId}: ${firstLine(this.opts.describeSession(s.sessionId).request)}`,
      );
    const fixes = trace.rounds.map(
      (r) => `- Round ${r.n} (${r.status}): ${firstLine(r.summary, 160)}`,
    );
    return [
      `## ${card.title}`,
      card.description.trim(),
      ...(worked.length > 0 ? ["## Sessions", worked.join("\n")] : []),
      ...(fixes.length > 0 ? ["## Fixes after review", fixes.join("\n")] : []),
      trace.workItem ? closingLine(trace.workItem) : null,
    ]
      .filter((part) => part)
      .join("\n\n");
  }
}
