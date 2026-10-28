import type { Database } from "bun:sqlite";
import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { type HistoryRecord, parseLines } from "./parser.ts";

export interface HistoryIndexerOptions {
  db: Database;
  /** Folders holding one directory per project, each with `<claudeSessionId>.jsonl` files. */
  roots: readonly string[];
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

  constructor(readonly opts: HistoryIndexerOptions) {
    this.db = opts.db;
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
      .query("SELECT offset, parse_errors FROM history_files WHERE path = ?")
      .get(path) as { offset: number; parse_errors: number } | null;
    const offset = row?.offset ?? 0;
    if (stat.size <= offset) return null;

    const chunk = Buffer.alloc(stat.size - offset);
    const fd = openSync(path, "r");
    try {
      readSync(fd, chunk, 0, chunk.length, offset);
    } finally {
      closeSync(fd);
    }
    // Only complete lines: a last line without its newline is left for the next pass.
    const end = chunk.lastIndexOf(0x0a) + 1;
    if (end === 0) return null;
    const { records, errors } = parseLines(chunk.subarray(0, end).toString("utf8"));

    this.db.transaction(() => {
      const insert = this.db.query(
        `INSERT OR IGNORE INTO history_messages (claude_session_id, uuid, ts, role, kind, text)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const r of records) insert.run(claudeSessionId, r.uuid, r.ts, r.role, r.kind, r.text);
      this.db
        .query(
          `INSERT INTO history_files (path, claude_session_id, size, mtime, offset, parse_errors)
           VALUES ($path, $id, $size, $mtime, $offset, $errors)
           ON CONFLICT(path) DO UPDATE SET size = $size, mtime = $mtime, offset = $offset,
             parse_errors = $errors`,
        )
        .run({
          path,
          id: claudeSessionId,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          offset: offset + end,
          errors: (row?.parse_errors ?? 0) + errors,
        });
      this.updateSession(claudeSessionId, path, records);
    })();
    return { claudeSessionId, path, added: records.length, reset: false };
  }

  /** Recomputes the session row from its stored messages and the records just read. */
  private updateSession(claudeSessionId: string, path: string, records: HistoryRecord[]): void {
    const existing = this.db
      .query("SELECT cwd, title FROM history_sessions WHERE claude_session_id = ?")
      .get(claudeSessionId) as { cwd: string; title: string | null } | null;
    const summary = records.filter((r) => r.kind === "summary").at(-1)?.text;
    const firstUser = records.find((r) => r.kind === "message" && r.role === "user")?.text;
    const title =
      summary ??
      existing?.title ??
      (firstUser === undefined ? null : Array.from(firstUser).slice(0, TITLE_CHARS).join(""));
    const cwd = existing?.cwd || records.find((r) => r.cwd)?.cwd || "";
    const totals = this.db
      .query(
        `SELECT MIN(ts) AS first, MAX(ts) AS last, SUM(kind = 'message') AS count
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
