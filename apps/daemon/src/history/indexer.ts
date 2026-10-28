import type { Database } from "bun:sqlite";
import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { type HistoryRecord, parseLines } from "./parser.ts";

export interface HistoryIndexerOptions {
  db: Database;
  /** Folders holding one directory per project, each with `<claudeSessionId>.jsonl` files. */
  roots: readonly string[];
  /** Sessions whose `cwd` is one of these folders, or inside one, are never indexed. */
  excludeCwds?: readonly string[];
}

export interface IndexResult {
  claudeSessionId: string;
  path: string;
  /** Records stored by this pass. */
  added: number;
  /** The file shrank and was indexed again from the start. */
  reset: boolean;
}

/** Fallback title: the first user message, cut to this many characters. */
const TITLE_CHARS = 120;

const caseInsensitive = process.platform === "win32" || process.platform === "darwin";

/** Comparable form of a folder: forward slashes, no trailing slash, case folded where the OS does. */
function normalizeCwd(path: string): string {
  const slashes = path.replaceAll("\\", "/").replace(/\/+$/, "");
  return caseInsensitive ? slashes.toLowerCase() : slashes;
}

const entries = (dir: string) => {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

/**
 * Indexes Claude Code transcripts incrementally: each file remembers the byte offset after the
 * last newline read, and the next pass reads only what came after it.
 */
export class HistoryIndexer {
  private readonly db: Database;
  private readonly excludes: string[];

  constructor(readonly opts: HistoryIndexerOptions) {
    this.db = opts.db;
    this.excludes = (opts.excludeCwds ?? []).map(normalizeCwd);
  }

  /** One pass over every root; returns the files that gained records. */
  scan(): IndexResult[] {
    const results: IndexResult[] = [];
    for (const path of this.files()) {
      const result = this.indexFile(path);
      if (result) results.push(result);
    }
    return results;
  }

  private files(): string[] {
    const files: string[] = [];
    for (const root of this.opts.roots) {
      for (const dir of entries(root)) {
        if (!dir.isDirectory()) continue;
        for (const file of entries(join(root, dir.name))) {
          if (file.isFile() && file.name.endsWith(".jsonl")) {
            files.push(join(root, dir.name, file.name));
          }
        }
      }
    }
    return files;
  }

  private indexFile(path: string): IndexResult | null {
    const stat = statSync(path);
    const claudeSessionId = basename(path, ".jsonl");
    const row = this.db
      .query("SELECT claude_session_id, offset, parse_errors FROM history_files WHERE path = ?")
      .get(path) as {
      claude_session_id: string | null;
      offset: number;
      parse_errors: number;
    } | null;
    // Smaller than what was already read: truncated or swapped, so start over.
    const reset = stat.size < (row?.offset ?? 0);
    const offset = reset ? 0 : (row?.offset ?? 0);
    if (!reset && stat.size === offset) return null;

    const chunk = Buffer.alloc(stat.size - offset);
    const fd = openSync(path, "r");
    try {
      readSync(fd, chunk, 0, chunk.length, offset);
    } finally {
      closeSync(fd);
    }
    // Only complete lines: a last line without its newline is left for the next pass.
    const end = chunk.lastIndexOf(0x0a) + 1;
    if (end === 0 && !reset) return null;
    const { records, errors } = parseLines(chunk.subarray(0, end).toString("utf8"));

    // An excluded file keeps its row with a null session id, so later passes skip it unread.
    const wasExcluded = !reset && row !== null && row.claude_session_id === null;
    const cwd = wasExcluded
      ? ""
      : this.sessionCwd(claudeSessionId) || records.find((r) => r.cwd)?.cwd || "";
    const excluded = wasExcluded || this.isExcluded(cwd);

    this.db.transaction(() => {
      if (reset || excluded) this.forget(claudeSessionId);
      const insert = this.db.query(
        `INSERT OR IGNORE INTO history_messages (claude_session_id, uuid, ts, role, kind, text)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      if (!excluded) {
        for (const r of records) insert.run(claudeSessionId, r.uuid, r.ts, r.role, r.kind, r.text);
      }
      this.db
        .query(
          `INSERT INTO history_files (path, claude_session_id, size, mtime, offset, parse_errors)
           VALUES ($path, $id, $size, $mtime, $offset, $errors)
           ON CONFLICT(path) DO UPDATE SET size = $size, mtime = $mtime, offset = $offset,
             parse_errors = $errors`,
        )
        .run({
          path,
          id: excluded ? null : claudeSessionId,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          offset: offset + end,
          errors: (reset ? 0 : (row?.parse_errors ?? 0)) + errors,
        });
      if (!excluded) this.updateSession(claudeSessionId, path, cwd, records);
    })();
    return excluded ? null : { claudeSessionId, path, added: records.length, reset };
  }

  /** Drops everything indexed for a session (its file row is rewritten by the caller). */
  private forget(claudeSessionId: string): void {
    this.db.query("DELETE FROM history_messages WHERE claude_session_id = ?").run(claudeSessionId);
    this.db.query("DELETE FROM history_sessions WHERE claude_session_id = ?").run(claudeSessionId);
  }

  private sessionCwd(claudeSessionId: string): string {
    const row = this.db
      .query("SELECT cwd FROM history_sessions WHERE claude_session_id = ?")
      .get(claudeSessionId) as { cwd: string } | null;
    return row?.cwd ?? "";
  }

  /** The project folder comes from the lines' `cwd`, never from the directory name. */
  private isExcluded(cwd: string): boolean {
    if (!cwd) return false;
    const path = normalizeCwd(cwd);
    return this.excludes.some((ex) => path === ex || path.startsWith(`${ex}/`));
  }

  /** Recomputes the session row from its stored messages and the records just read. */
  private updateSession(
    claudeSessionId: string,
    path: string,
    cwd: string,
    records: HistoryRecord[],
  ): void {
    const existing = this.db
      .query("SELECT title FROM history_sessions WHERE claude_session_id = ?")
      .get(claudeSessionId) as { title: string | null } | null;
    const summary = records.filter((r) => r.kind === "summary").at(-1)?.text;
    const firstUser = records.find((r) => r.kind === "message" && r.role === "user")?.text;
    const title =
      summary ??
      existing?.title ??
      (firstUser === undefined ? null : Array.from(firstUser).slice(0, TITLE_CHARS).join(""));
    const totals = this.db
      .query(
        `SELECT MIN(ts) AS first, MAX(ts) AS last, COALESCE(SUM(kind = 'message'), 0) AS count
         FROM history_messages WHERE claude_session_id = ?`,
      )
      .get(claudeSessionId) as { first: string | null; last: string | null; count: number };
    this.db
      .query(
        `INSERT INTO history_sessions
           (claude_session_id, cwd, title, first_ts, last_ts, message_count, origin, file_path)
         VALUES ($id, $cwd, $title, $first, $last, $count, 'external', $path)
         ON CONFLICT(claude_session_id) DO UPDATE SET cwd = $cwd, title = $title,
           first_ts = $first, last_ts = $last, message_count = $count, file_path = $path`,
      )
      .run({ id: claudeSessionId, cwd, title, ...totals, path });
  }
}
