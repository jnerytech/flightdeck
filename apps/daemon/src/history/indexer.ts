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
  /** Whether SQLite has FTS5; detected when absent (injectable so tests cover both paths). */
  fts5?: boolean;
  log?: (message: string) => void;
}

export interface SearchQuery {
  query: string;
  /** Only sessions in this folder or below it. */
  cwd?: string;
  /** ISO timestamps, inclusive. */
  from?: string;
  to?: string;
  limit?: number;
}

export interface SearchHit {
  claudeSessionId: string;
  uuid: string;
  ts: string | null;
  cwd: string;
  title: string | null;
  role: string;
  /** Excerpt around the match, each match wrapped in `«` and `»`. */
  snippet: string;
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

/** `flightdeck` when the transcript belongs to a session this daemon manages. */
const ORIGIN = `CASE WHEN EXISTS (SELECT 1 FROM sessions WHERE claude_session_id = $id)
  THEN 'flightdeck' ELSE 'external' END`;

/** Characters of context kept on each side of the first match. */
const SNIPPET_RADIUS = 60;

/** Excerpt around the first matched term, every term occurrence wrapped in `«»`. */
function snippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  const found = terms.map((t) => lower.indexOf(t.toLowerCase())).filter((i) => i >= 0);
  const first = found.length > 0 ? Math.min(...found) : 0;
  const start = Math.max(0, first - SNIPPET_RADIUS);
  const end = Math.min(text.length, first + SNIPPET_RADIUS * 2);
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(escaped.join("|"), "gi");
  const excerpt = text.slice(start, end).replace(/\s+/g, " ").replace(pattern, "«$&»");
  return `${start > 0 ? "…" : ""}${excerpt}${end < text.length ? "…" : ""}`;
}

/** FTS5 compiled into this SQLite (Bun bundles it; system builds may not). */
function fts5Available(db: Database): boolean {
  return (
    db.query("SELECT 1 FROM pragma_compile_options WHERE compile_options = 'ENABLE_FTS5'").get() !==
    null
  );
}

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
  /** Full-text search through FTS5; `LIKE` otherwise. */
  readonly fts: boolean;

  constructor(readonly opts: HistoryIndexerOptions) {
    this.db = opts.db;
    this.excludes = (opts.excludeCwds ?? []).map(normalizeCwd);
    this.fts = opts.fts5 ?? fts5Available(this.db);
    opts.log?.(
      this.fts ? "histórico: busca com FTS5" : "histórico: FTS5 indisponível, busca com LIKE",
    );
    // Only message rows go into the index: raw lines and tool results are never searchable.
    if (this.fts) {
      this.db.run(
        "CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(text, content='history_messages')",
      );
    }
  }

  /** Messages containing every term, newest first. */
  search(query: SearchQuery): SearchHit[] {
    const terms = query.query.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const where = ["m.kind = 'message'"];
    const params: Record<string, string | number> = { limit: query.limit ?? 20 };
    let source = "history_messages m";
    if (this.fts) {
      source = "history_fts JOIN history_messages m ON m.rowid = history_fts.rowid";
      where.push("history_fts MATCH $match");
      // Each term quoted (no FTS syntax from the user) and matched as a prefix.
      params.match = terms.map((t) => `"${t.replaceAll('"', '""')}"*`).join(" ");
    } else {
      terms.forEach((term, i) => {
        where.push(`m.text LIKE $t${i} ESCAPE '\\'`);
        params[`t${i}`] = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
      });
    }
    if (query.cwd) {
      where.push(
        "(s.cwd = $cwd OR substr(s.cwd, 1, length($cwd) + 1) IN ($cwd || '/', $cwd || '\\'))",
      );
      params.cwd = query.cwd.replace(/[\\/]+$/, "");
    }
    if (query.from) {
      where.push("m.ts >= $from");
      params.from = query.from;
    }
    if (query.to) {
      where.push("m.ts <= $to");
      params.to = query.to;
    }
    const rows = this.db
      .query(
        `SELECT m.claude_session_id, m.uuid, m.ts, s.cwd, s.title, m.role, m.text
         FROM ${source} JOIN history_sessions s ON s.claude_session_id = m.claude_session_id
         WHERE ${where.join(" AND ")}
         ORDER BY m.ts DESC, m.rowid DESC LIMIT $limit`,
      )
      .all(params) as Array<{
      claude_session_id: string;
      uuid: string;
      ts: string | null;
      cwd: string;
      title: string | null;
      role: string;
      text: string;
    }>;
    return rows.map((r) => ({
      claudeSessionId: r.claude_session_id,
      uuid: r.uuid,
      ts: r.ts,
      cwd: r.cwd,
      title: r.title,
      role: r.role,
      snippet: snippet(r.text, terms),
    }));
  }

  /** One pass over every root; returns the files that gained records. */
  scan(): IndexResult[] {
    // A managed session may get its claudeSessionId after its transcript was indexed.
    this.db.run(
      `UPDATE history_sessions SET origin = 'flightdeck' WHERE origin = 'external'
         AND claude_session_id IN (SELECT claude_session_id FROM sessions)`,
    );
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
         VALUES ($id, $cwd, $title, $first, $last, $count, ${ORIGIN}, $path)
         ON CONFLICT(claude_session_id) DO UPDATE SET cwd = $cwd, title = $title,
           first_ts = $first, last_ts = $last, message_count = $count, origin = ${ORIGIN},
           file_path = $path`,
      )
      .run({ id: claudeSessionId, cwd, title, ...totals, path });
  }
}
