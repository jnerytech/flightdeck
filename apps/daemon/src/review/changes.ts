import type { Database } from "bun:sqlite";
import { existsSync, watch as fsWatch } from "node:fs";
import { resolve } from "node:path";
import type { Board } from "../board/board.ts";
import { git } from "../board/command.ts";
import { cardDiff, workingDiff } from "../board/diff.ts";
import type { DiffFile } from "../board/types.ts";
import { FlightdeckError } from "../errors.ts";
import type { Timers } from "../quota/quota.ts";

/** Watches a folder recursively; `filename` is relative to it (`null` when the OS does not say). */
export type WatchFn = (
  root: string,
  onEvent: (filename: string | null) => void,
) => { close(): void };

export interface ChangesOptions {
  db: Database;
  /** Cards and their projects (`card:<id>` targets). */
  board?: Board;
  /** Recursive `fs.watch` when absent. */
  watch?: WatchFn;
  timers?: Timers;
  /** Wait after a change on disk before the diff is computed again; 500 ms when absent. */
  debounceMs?: number;
  log?: (message: string) => void;
}

/** What a target (`session:<claudeSessionId>` or `card:<id>`) points at. */
export interface ResolvedTarget {
  target: string;
  /** The repository's top level (the worktree, for a card). */
  root: string;
  /** The card's base branch; `null` for a session, whose diff is against `HEAD`. */
  base: string | null;
  cardId: string | null;
  claudeSessionId: string | null;
}

export interface ChangesResult {
  target: string;
  root: string;
  base: string | null;
  files: DiffFile[];
}

const DEBOUNCE_MS = 500;

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const realWatch: WatchFn = (root, onEvent) =>
  fsWatch(root, { recursive: true }, (_event, filename) => onEvent(filename?.toString() ?? null));

/** Git's own writes (`.git/index` on every diff) and the card worktrees are not changes. */
const IGNORED = new Set([".git", ".flightdeck"]);
const ignored = (filename: string | null) =>
  filename !== null && IGNORED.has(filename.split(/[\\/]/)[0] ?? "");

/** Where a session ran: managed, then opened in the terminal, then only in the history. */
const SESSION_CWD = `SELECT cwd FROM (
  SELECT cwd, 1 AS rank, updated_at AS at FROM sessions WHERE claude_session_id = $id
  UNION ALL SELECT cwd, 2, last_event_at FROM external_sessions WHERE claude_session_id = $id
  UNION ALL SELECT cwd, 3, last_ts FROM history_sessions WHERE claude_session_id = $id
) WHERE cwd IS NOT NULL AND cwd <> '' ORDER BY rank, at DESC LIMIT 1`;

/**
 * The working tree of any session or card, as a diff. The folder always comes from what the
 * daemon recorded (sessions, external sessions, history, card worktrees), never from the client.
 */
export class Changes {
  private readonly timers: Timers;

  constructor(readonly opts: ChangesOptions) {
    this.timers = opts.timers ?? realTimers;
  }

  async resolve(target: string): Promise<ResolvedTarget> {
    const match = /^(session|card):(.+)$/.exec(target);
    if (!match) throw new FlightdeckError("bad_request", `alvo inválido: ${target}`);
    const [, kind, id] = match as unknown as [string, "session" | "card", string];
    if (kind === "card") {
      if (!this.opts.board) throw new FlightdeckError("not_found", `card ${id} não existe`);
      const card = this.opts.board.getCard(id);
      if (!card.worktreePath) throw new FlightdeckError("invalid_state", "card ainda sem worktree");
      const base = this.opts.board.getProject(card.projectId).baseBranch;
      return { target, root: card.worktreePath, base, cardId: id, claudeSessionId: null };
    }
    const row = this.opts.db.query(SESSION_CWD).get({ id }) as { cwd: string } | null;
    if (!row) throw new FlightdeckError("not_found", `sessão ${id} não existe`);
    // A folder that no longer exists is not a repository either.
    const top = existsSync(row.cwd)
      ? await git(row.cwd, "rev-parse", "--show-toplevel")
      : { code: 1, stdout: "" };
    if (top.code !== 0) {
      throw new FlightdeckError("invalid_state", `${row.cwd} não está num repositório git`);
    }
    return {
      target,
      root: resolve(top.stdout.trim()),
      base: null,
      cardId: null,
      claudeSessionId: id,
    };
  }

  async get(target: string): Promise<ChangesResult> {
    const { root, base } = await this.resolve(target);
    const files = base === null ? await workingDiff(root) : (await cardDiff(root, base)).files;
    return { target, root, base, files };
  }

  /**
   * The diff again after changes on disk: the first change starts a window of `debounceMs`, and
   * one diff goes out at its end. Returns the stop function.
   */
  async watch(target: string, listener: (result: ChangesResult) => void): Promise<() => void> {
    const { root } = await this.resolve(target);
    let pending: unknown = null;
    const watcher = (this.opts.watch ?? realWatch)(root, (filename) => {
      if (ignored(filename) || pending !== null) return;
      pending = this.timers.set(() => {
        pending = null;
        // The target may be gone meanwhile (a card discarded): nothing to send, a line in the log.
        void this.get(target).then(listener, (error: unknown) =>
          this.opts.log?.(`mudanças: diff de ${target} falhou (${describe(error)})`),
        );
      }, this.opts.debounceMs ?? DEBOUNCE_MS);
    });
    return () => {
      if (pending !== null) this.timers.clear(pending);
      watcher.close();
    };
  }
}
