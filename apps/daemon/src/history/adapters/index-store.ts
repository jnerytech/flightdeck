import type { Database } from "bun:sqlite";
import type { HistoryRecord } from "../domain/parser.ts";
import { entrypointOf, sessionTitle, titleFrom } from "../domain/session-summary.ts";
import { promptText } from "../domain/transcript-text.ts";

/** What a pass over one transcript slice decided, for the store to write in one transaction. */
export interface SliceWrite {
  claudeSessionId: string;
  path: string;
  cwd: string;
  records: HistoryRecord[];
  /** The session is under an excluded folder: nothing of it is kept. */
  excluded: boolean;
  /** The file shrank: what was indexed for the session is dropped first. */
  reset: boolean;
  size: number;
  mtime: string;
  /** The byte offset after the last whole line read. */
  offset: number;
  /** Parse errors counted so far for the file, this slice's included. */
  parseErrors: number;
}

/** What the store remembers of one file between passes. */
export interface FileRow {
  claude_session_id: string | null;
  offset: number;
  parse_errors: number;
}

/** `flightdeck` when the transcript belongs to a session this daemon manages. */
const ORIGIN = `CASE WHEN EXISTS (SELECT 1 FROM sessions WHERE claude_session_id = $id)
  THEN 'flightdeck' ELSE 'external' END`;

/**
 * The SQLite side of the history index (#1589): the file rows that remember how far each
 * transcript was read, the messages with their FTS5 entries, and the session rows. The indexer
 * decides what to read and keep; this writes it.
 */
export class IndexStore {
  constructor(
    private readonly db: Database,
    private readonly fts: boolean,
  ) {}

  /** Only message rows go into the index: raw lines and tool results are never searchable. */
  createFts(): void {
    this.db.run(
      "CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(text, content='history_messages')",
    );
  }

  /**
   * A title an older daemon stored from a harness wrapper (`<system-reminder>…`) is taken again
   * from the session's own messages: the first one with real text, else none.
   */
  repairTitles(): void {
    const stale = this.db
      .query("SELECT claude_session_id AS id FROM history_sessions WHERE title LIKE '<%'")
      .all() as Array<{ id: string }>;
    for (const { id } of stale) {
      const users = this.db
        .query(
          "SELECT text FROM history_messages WHERE claude_session_id = ? AND kind = 'message' AND role = 'user' ORDER BY rowid",
        )
        .all(id) as Array<{ text: string }>;
      const first = users.map((u) => promptText(u.text)).find((text) => text !== null);
      const title = titleFrom(first);
      this.db
        .query("UPDATE history_sessions SET title = ? WHERE claude_session_id = ?")
        .run(title, id);
    }
  }

  /** A managed session may get its claudeSessionId after its transcript was indexed. */
  claimManaged(): void {
    this.db.run(
      `UPDATE history_sessions SET origin = 'flightdeck' WHERE origin = 'external'
         AND claude_session_id IN (SELECT claude_session_id FROM sessions)`,
    );
  }

  /** Drops everything indexed. */
  clear(): void {
    this.db.transaction(() => {
      if (this.fts) this.db.run("INSERT INTO history_fts (history_fts) VALUES ('delete-all')");
      this.db.run("DELETE FROM history_messages");
      this.db.run("DELETE FROM history_sessions");
      this.db.run("DELETE FROM history_files");
    })();
  }

  counts(): { sessions: number; messages: number } {
    const count = (sql: string) => (this.db.query(sql).get() as { n: number }).n;
    return {
      sessions: count("SELECT COUNT(*) AS n FROM history_sessions"),
      messages: count("SELECT COUNT(*) AS n FROM history_messages WHERE kind = 'message'"),
    };
  }

  fileRow(path: string): FileRow | null {
    return this.db
      .query("SELECT claude_session_id, offset, parse_errors FROM history_files WHERE path = ?")
      .get(path) as FileRow | null;
  }

  sessionCwd(claudeSessionId: string): string {
    const row = this.db
      .query("SELECT cwd FROM history_sessions WHERE claude_session_id = ?")
      .get(claudeSessionId) as { cwd: string } | null;
    return row?.cwd ?? "";
  }

  /** Stores one slice: the messages, the file's new offset and, unless excluded, the session row. */
  write(slice: SliceWrite): void {
    const { claudeSessionId, path, cwd, records, excluded, reset } = slice;
    this.db.transaction(() => {
      if (reset || excluded) this.forget(claudeSessionId);
      const insert = this.db.query(
        `INSERT OR IGNORE INTO history_messages (claude_session_id, uuid, ts, role, kind, text)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const ftsInsert = this.fts
        ? this.db.query("INSERT INTO history_fts (rowid, text) VALUES (?, ?)")
        : null;
      for (const r of excluded ? [] : records) {
        const { changes, lastInsertRowid } = insert.run(
          claudeSessionId,
          r.uuid,
          r.ts,
          r.role,
          r.kind,
          r.text,
        );
        if (ftsInsert && changes > 0 && r.kind === "message")
          ftsInsert.run(lastInsertRowid, r.text);
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
          size: slice.size,
          mtime: slice.mtime,
          offset: slice.offset,
          errors: slice.parseErrors,
        });
      if (!excluded) this.updateSession(claudeSessionId, path, cwd, records);
    })();
  }

  /** Drops everything indexed for a session (its file row is rewritten by the caller). */
  private forget(claudeSessionId: string): void {
    // External-content FTS5 needs the old text to drop its entries.
    if (this.fts) {
      this.db.run(
        `INSERT INTO history_fts (history_fts, rowid, text)
         SELECT 'delete', rowid, text FROM history_messages
         WHERE claude_session_id = ? AND kind = 'message'`,
        [claudeSessionId],
      );
    }
    this.db.query("DELETE FROM history_messages WHERE claude_session_id = ?").run(claudeSessionId);
    this.db.query("DELETE FROM history_sessions WHERE claude_session_id = ?").run(claudeSessionId);
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
    const title = sessionTitle(records, existing?.title ?? null);
    const totals = this.db
      .query(
        `SELECT MIN(ts) AS first, MAX(ts) AS last, COALESCE(SUM(kind = 'message'), 0) AS count
         FROM history_messages WHERE claude_session_id = ?`,
      )
      .get(claudeSessionId) as { first: string | null; last: string | null; count: number };
    const entrypoint = entrypointOf(records);
    this.db
      .query(
        `INSERT INTO history_sessions
           (claude_session_id, cwd, title, first_ts, last_ts, message_count, origin, file_path, entrypoint)
         VALUES ($id, $cwd, $title, $first, $last, $count, ${ORIGIN}, $path, $entrypoint)
         ON CONFLICT(claude_session_id) DO UPDATE SET cwd = $cwd, title = $title,
           first_ts = $first, last_ts = $last, message_count = $count, origin = ${ORIGIN},
           file_path = $path, entrypoint = COALESCE(history_sessions.entrypoint, $entrypoint)`,
      )
      .run({ id: claudeSessionId, cwd, title, ...totals, path, entrypoint });
  }
}
