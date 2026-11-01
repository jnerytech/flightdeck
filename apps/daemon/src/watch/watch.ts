import type { Database } from "bun:sqlite";
import type { Board } from "../board/board.ts";
import { type PrCheck, type PrComment, type PrProvider, prProvider } from "../board/pr.ts";
import type { PrProviderKind } from "../board/types.ts";
import { TRUSTED_ASSOCIATIONS } from "../issues/providers.ts";

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
  /** Minutes each local check gets before it is killed. */
  checkTimeoutMin: number;
  /** Estimated cost of the rounds of a PR, in US$; `null` for no limit. */
  budgetUsd: number | null;
  /** Turns of the rounds of a PR; `null` for no limit. */
  maxTurns: number | null;
  /** The persona the fixing session runs in. */
  persona: string;
  /** Rounds in a row that fail before the card asks for you. */
  maxFailures: number;
  /** Estimated cost of every fixing round of the project in a day, in US$; `null` for no limit. */
  dailyUsd: number | null;
}

export interface PrWatcherOptions {
  db: Database;
  board: Pick<Board, "getCard" | "getProject">;
  /** The PR host of a kind of project; the real CLIs when absent (the tests' fakes win on PATH). */
  provider?: (kind: PrProviderKind) => PrProvider | null;
  /** Called once for each time a PR got worse. */
  onTrigger?: (trigger: WatchTrigger) => void | Promise<void>;
}

/** The rounds a card has kept so far, as SQL (a value of `round_base`). */
const COUNT_ROUNDS = "(SELECT COUNT(*) FROM pr_watch_rounds WHERE card_id = ?1)";

const DEFAULT_SETTINGS: WatchSettings = {
  enabled: false,
  maxRounds: 3,
  checks: [],
  checkTimeoutMin: 10,
  budgetUsd: 5,
  maxTurns: 30,
  persona: "revisor",
  maxFailures: 2,
  dailyUsd: 20,
};

/** What the last look found, to tell what got worse at the next one. */
interface Snapshot {
  /** The failing builds, by name and build id: a new run that fails is news. */
  failing: string[];
  conflicts: boolean;
  /** Every comment seen, resolved or not. */
  seen: string[];
}

const EMPTY: Snapshot = { failing: [], conflicts: false, seen: [] };

/** A comment you can act on: the host says its author is part of the team. */
function isTrustedComment(comment: PrComment): boolean {
  if (comment.authorIdentity !== null) return true;
  return TRUSTED_ASSOCIATIONS.has((comment.authorAssociation ?? "").toUpperCase());
}

/** Watches the open PRs of cards: reads their builds, conflicts and comments each round. */
export class PrWatcher {
  private stopped = false;

  constructor(private readonly opts: PrWatcherOptions) {}

  settings(projectId: string): WatchSettings {
    const row = this.opts.db
      .query<{ settings: string }, [string]>(
        "SELECT settings FROM pr_watch_project WHERE project_id = ?",
      )
      .get(projectId);
    return { ...DEFAULT_SETTINGS, ...(row ? JSON.parse(row.settings) : {}) };
  }

  setSettings(projectId: string, patch: Partial<WatchSettings>): WatchSettings {
    const next = { ...this.settings(projectId), ...patch };
    this.opts.db
      .query(
        `INSERT INTO pr_watch_project (project_id, settings) VALUES (?, ?)
         ON CONFLICT (project_id) DO UPDATE SET settings = excluded.settings`,
      )
      .run(projectId, JSON.stringify(next));
    return next;
  }

  /** Whether the card's PR is watched: its own choice, else the project's default. */
  enabled(cardId: string): boolean {
    const row = this.opts.db
      .query<{ enabled: number | null }, [string]>("SELECT enabled FROM pr_watch WHERE card_id = ?")
      .get(cardId);
    if (row?.enabled != null) return row.enabled === 1;
    return this.settings(this.opts.board.getCard(cardId).projectId).enabled;
  }

  /**
   * The card's own choice; `null` goes back to the project's default. Everything is news again,
   * and the rounds done so far stop counting against the limits.
   */
  setEnabled(cardId: string, enabled: boolean | null): void {
    this.opts.db
      .query(
        `INSERT INTO pr_watch (card_id, enabled, snapshot, status, reason, round_base, updated_at)
         VALUES (?1, ?2, NULL, 'watching', NULL, ${COUNT_ROUNDS}, ?3)
         ON CONFLICT (card_id) DO UPDATE SET enabled = excluded.enabled, snapshot = NULL,
           status = 'watching', reason = NULL, round_base = excluded.round_base,
           updated_at = excluded.updated_at`,
      )
      .run(cardId, enabled === null ? null : Number(enabled), new Date().toISOString());
  }

  /** `needs_you` once a limit was hit or a round failed for good; `setEnabled` starts over. */
  status(cardId: string): { status: "watching" | "needs_you"; reason: string | null } {
    const row = this.opts.db
      .query<{ status: "watching" | "needs_you"; reason: string | null }, [string]>(
        "SELECT status, reason FROM pr_watch WHERE card_id = ?",
      )
      .get(cardId);
    return row ?? { status: "watching", reason: null };
  }

  /** How many rounds of this card count against the limits: those since the last (re)start. */
  roundsSinceStart(cardId: string): number {
    const row = this.opts.db
      .query<{ n: number }, [string, string]>(
        `SELECT (SELECT COUNT(*) FROM pr_watch_rounds WHERE card_id = ?1)
                - COALESCE((SELECT round_base FROM pr_watch WHERE card_id = ?2), 0) AS n`,
      )
      .get(cardId, cardId);
    return row?.n as number;
  }

  /** The card waits for you: nothing more is fixed until you turn Vigiar off and on again. */
  markNeedsYou(cardId: string, reason: string): void {
    this.opts.db
      .query(
        `INSERT INTO pr_watch (card_id, enabled, snapshot, status, reason, updated_at)
         VALUES (?, NULL, NULL, 'needs_you', ?, ?)
         ON CONFLICT (card_id) DO UPDATE SET status = 'needs_you', reason = excluded.reason,
           updated_at = excluded.updated_at`,
      )
      .run(cardId, reason, new Date().toISOString());
  }

  /** Phase 22: after this nothing is read, saved or fired (the daemon is stopping). */
  stop(): void {
    this.stopped = true;
  }

  /** One round: looks at every watched card with an open PR; a host that fails waits for the next. */
  async tick(): Promise<void> {
    if (this.stopped) return;
    const open = this.opts.db
      .query<{ id: string }, []>(
        "SELECT id FROM cards WHERE pr_state = 'open' AND pr_url IS NOT NULL",
      )
      .all();
    for (const { id } of open) {
      if (this.stopped) return;
      if (this.enabled(id) && this.status(id).status === "watching")
        await this.look(id).catch(() => {});
    }
  }

  private snapshot(cardId: string): Snapshot {
    const row = this.opts.db
      .query<{ snapshot: string | null }, [string]>(
        "SELECT snapshot FROM pr_watch WHERE card_id = ?",
      )
      .get(cardId);
    return row?.snapshot ? (JSON.parse(row.snapshot) as Snapshot) : EMPTY;
  }

  private async look(cardId: string): Promise<void> {
    const card = this.opts.board.getCard(cardId);
    const project = this.opts.board.getProject(card.projectId);
    const provider = (this.opts.provider ?? prProvider)(project.prProvider);
    if (!provider || !card.prUrl) return;
    const where = { cwd: project.path, url: card.prUrl };
    const [health, comments] = await Promise.all([
      provider.health(where),
      provider.comments(where),
    ]);
    if (this.stopped) return;
    const before = this.snapshot(cardId);
    const failing = health.checks.filter((c) => c.kind === "build" && c.state === "failing");
    const now: Snapshot = {
      failing: failing.map((c) => `${c.name}#${c.buildId}`),
      conflicts: health.conflicts,
      seen: comments.map((c) => c.id),
    };
    const trigger: WatchTrigger = {
      cardId,
      failed: failing.filter((c) => !before.failing.includes(`${c.name}#${c.buildId}`)),
      conflicts: health.conflicts && !before.conflicts,
      comments: comments.filter(
        (c) => !c.resolved && isTrustedComment(c) && !before.seen.includes(c.id),
      ),
    };
    if (trigger.failed.length > 0 || trigger.conflicts || trigger.comments.length > 0) {
      await this.opts.onTrigger?.(trigger);
    }
    if (this.stopped) return;
    this.opts.db
      .query(
        `INSERT INTO pr_watch (card_id, enabled, snapshot, updated_at) VALUES (?, NULL, ?, ?)
         ON CONFLICT (card_id) DO UPDATE SET snapshot = excluded.snapshot,
           updated_at = excluded.updated_at`,
      )
      .run(cardId, JSON.stringify(now), new Date().toISOString());
  }
}
