import type { Database } from "bun:sqlite";
import { watch as fsWatch } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Board } from "../board/board.ts";
import { git } from "../board/command.ts";
import { cardDiff, workingDiff } from "../board/diff.ts";
import { aheadBehind } from "../board/merge.ts";
import { HEAD, type Rev, refArg } from "../board/ref-arg.ts";
import type { DiffFile } from "../board/types.ts";
import { FlightdeckError } from "../errors.ts";
import { resolveAllowedCwd } from "../paths.ts";
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
  /** The folders terminals were opened in (`terminal:<id>` targets, #506). */
  terminals?: { cwdOf(terminalId: string): string | null };
  /** A project's checkout (`project:<id>` targets, #797) is a target only inside these. */
  allowedRoots?: readonly string[];
}

/** What a target (`session:<claudeSessionId>` or `card:<id>`) points at. */
export interface ResolvedTarget {
  target: string;
  /** The repository's top level (the worktree, for a card). */
  root: string;
  /** The card's base branch; `null` for a session, whose diff is against `HEAD`. */
  base: Rev | null;
  cardId: string | null;
  claudeSessionId: string | null;
  /** The card's branch: its position is read from it, never from a `HEAD` that a rebase detaches. */
  branch?: string;
}

export interface ChangesResult {
  target: string;
  root: string;
  base: string | null;
  files: DiffFile[];
  /** A card's commits ahead of and behind its base; `null` for a session. */
  position: { ahead: number; behind: number } | null;
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

  /** `terminal`: the caller only reads files (`file.read`, `file.list`), the one use of a terminal's folder (#506). */
  async resolve(target: string, opts: { terminal?: boolean } = {}): Promise<ResolvedTarget> {
    const match = /^(session|card|terminal|project):(.+)$/.exec(target);
    if (!match)
      throw new FlightdeckError(
        "bad_request",
        `invalid target: ${target}`,
        "review_target_invalid",
        { target },
      );
    const [, kind, id] = match as unknown as [
      string,
      "session" | "card" | "terminal" | "project",
      string,
    ];
    if (kind === "project") return this.projectTarget(target, id);
    if (kind === "terminal") return this.terminalTarget(target, id, opts.terminal === true);
    if (kind === "card") return this.cardTarget(target, id);
    const row = this.opts.db.query(SESSION_CWD).get({ id }) as { cwd: string } | null;
    if (!row) {
      throw new FlightdeckError("not_found", `session ${id} does not exist`, "session_not_found", {
        id,
      });
    }
    // A folder that no longer exists is not a repository either.
    const top = (await stat(row.cwd).then(
      () => true,
      () => false,
    ))
      ? await git(row.cwd, "rev-parse", "--show-toplevel")
      : { code: 1, stdout: "" };
    if (top.code !== 0) {
      throw new FlightdeckError(
        "invalid_state",
        `${row.cwd} is not in a git repository`,
        "repo_not_git",
        { path: row.cwd },
      );
    }
    return {
      target,
      root: resolve(top.stdout.trim()),
      base: null,
      cardId: null,
      claudeSessionId: id,
    };
  }

  /** A terminal's folder, as the daemon opened it: never a folder the client names (#506). */
  private terminalTarget(target: string, id: string, readsFiles: boolean): ResolvedTarget {
    if (!readsFiles) {
      throw new FlightdeckError(
        "bad_request",
        `a terminal target only reads files: ${target}`,
        "review_target_invalid",
        { target },
      );
    }
    const cwd = this.opts.terminals?.cwdOf(id) ?? null;
    if (cwd === null) {
      throw new FlightdeckError("not_found", `terminal ${id} does not exist`, "terminal_missing", {
        id,
      });
    }
    return { target, root: resolve(cwd), base: null, cardId: null, claudeSessionId: null };
  }

  /**
   * A project's own checkout (#797), against `HEAD` like a session: the folder is the project's
   * record, never one the client names, and only inside the allowed roots.
   */
  private async projectTarget(target: string, id: string): Promise<ResolvedTarget> {
    if (!this.opts.board) {
      throw new FlightdeckError("not_found", `project ${id} does not exist`, "project_not_found", {
        id,
      });
    }
    const { path } = this.opts.board.getProject(id);
    const root = await resolveAllowedCwd(path, this.opts.allowedRoots ?? []);
    return { target, root, base: null, cardId: null, claudeSessionId: null };
  }

  /** A card's worktree against its project's base branch. */
  private cardTarget(target: string, id: string): ResolvedTarget {
    if (!this.opts.board) {
      throw new FlightdeckError("not_found", `card ${id} does not exist`, "card_not_found", {
        id,
      });
    }
    const card = this.opts.board.getCard(id);
    if (!card.worktreePath) {
      throw new FlightdeckError(
        "invalid_state",
        "the card has no worktree yet",
        "card_no_worktree",
      );
    }
    const base = refArg(this.opts.board.getProject(card.projectId).baseBranch);
    return {
      target,
      root: card.worktreePath,
      base,
      cardId: id,
      claudeSessionId: null,
      ...(card.branch ? { branch: card.branch } : {}),
    };
  }

  async get(target: string): Promise<ChangesResult> {
    const { root, base, branch } = await this.resolve(target);
    if (base === null)
      return { target, root, base, files: await workingDiff(root), position: null };
    const { files } = await cardDiff(root, base);
    return {
      target,
      root,
      base,
      files,
      position: await aheadBehind(root, base, branch ? refArg(branch) : HEAD),
    };
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
