/** Full-text search over the indexed messages (#1589): the query, the excerpt and FTS5 or `LIKE`. */
import type { Database } from "bun:sqlite";
import { CWD_CONDITION, trimSlashes } from "./folder.ts";

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

/** Characters of context kept on each side of the first match. */
const SNIPPET_RADIUS = 60;

/** Excerpt around the first matched term, every term occurrence wrapped in `«»`. */
function snippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  const found = terms.map((t) => lower.indexOf(t.toLowerCase())).filter((i) => i >= 0);
  const first = found.length > 0 ? Math.min(...found) : 0;
  const start = Math.max(0, first - SNIPPET_RADIUS);
  const end = Math.min(text.length, first + SNIPPET_RADIUS * 2);
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`));
  const pattern = new RegExp(escaped.join("|"), "gi");
  const excerpt = text.slice(start, end).replace(/\s+/g, " ").replace(pattern, "«$&»");
  return `${start > 0 ? "…" : ""}${excerpt}${end < text.length ? "…" : ""}`;
}

/** FTS5 compiled into this SQLite (Bun bundles it; system builds may not). */
export function fts5Available(db: Database): boolean {
  return (
    db.query("SELECT 1 FROM pragma_compile_options WHERE compile_options = 'ENABLE_FTS5'").get() !==
    null
  );
}

/** Messages containing every term, newest first; through FTS5 when `fts`, `LIKE` otherwise. */
export function searchMessages(db: Database, fts: boolean, query: SearchQuery): SearchHit[] {
  const terms = query.query.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const where = ["m.kind = 'message'"];
  const params: Record<string, string | number> = { limit: query.limit ?? 20 };
  let source = "history_messages m";
  if (fts) {
    source = "history_fts JOIN history_messages m ON m.rowid = history_fts.rowid";
    where.push("history_fts MATCH $match");
    // Each term quoted (no FTS syntax from the user) and matched as a prefix.
    params.match = terms.map((t) => `"${t.replaceAll('"', '""')}"*`).join(" ");
  } else {
    terms.forEach((term, i) => {
      where.push(String.raw`m.text LIKE $t${i} ESCAPE '\'`);
      params[`t${i}`] = "%" + term.replace(/[\\%_]/g, String.raw`\$&`) + "%";
    });
  }
  if (query.cwd) {
    where.push(CWD_CONDITION);
    params.cwd = trimSlashes(query.cwd);
  }
  if (query.from) {
    where.push("m.ts >= $from");
    params.from = query.from;
  }
  if (query.to) {
    where.push("m.ts <= $to");
    params.to = query.to;
  }
  const rows = db
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
