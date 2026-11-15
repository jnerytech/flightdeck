import type { Database } from "bun:sqlite";
import { createReadStream } from "node:fs";
import { stat as fileStat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { HistoryMessage, HistorySessionSummary } from "@flightdeck/protocol";
import { FlightdeckError } from "../kernel/index.ts";
import { CWD_CONDITION, trimSlashes } from "./domain/folder.ts";
import { lastTool, requestLine } from "./domain/session-line.ts";
import { type ToolDetail, toolDetail } from "./domain/tool-detail.ts";
import { type SearchHit, type SearchQuery, searchMessages } from "./search.ts";

/**
 * What the history reads out of the index (#1589): the session lists, a transcript's pages, the
 * search and the small lookups the other domains ask for. The indexer writes the tables; this
 * module only reads them, so a change to a read never touches how a transcript is indexed.
 */

/** The lines of a file, read as they are asked for: a caller that stops early closes the file. */
async function* fileLines(path: string): AsyncGenerator<string> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  try {
    for await (const line of reader) yield line;
  } finally {
    reader.close();
    stream.destroy();
  }
}

export type HistorySession = HistorySessionSummary;

export interface HistoryListFilter {
  cwd?: string;
  /** Exactly these folders (not their children): the folders of one project. */
  cwds?: string[];
  from?: string;
  to?: string;
  origin?: "flightdeck" | "external";
  hideAutomated?: boolean;
  limit?: number;
  cursor?: string;
}

/** A file that changed this recently may still be written by a running `claude`. */
export const MAYBE_ACTIVE_MS = 2 * 60_000;

/** Kinds shown by `history.get`: tool results and raw lines are not readable text. */
const READABLE = "'message', 'summary', 'system'";

/**
 * A run nobody typed: print-mode (an sdk entrypoint), or in a temp folder (a folder called temp or
 * tmp, or macOS's /var/folders), whatever the slash or case.
 */
const AUTOMATED = `(s.entrypoint LIKE 'sdk%' OR
  '/' || replace(lower(s.cwd), char(92), '/') || '/' LIKE '%/temp/%' OR
  '/' || replace(lower(s.cwd), char(92), '/') || '/' LIKE '%/tmp/%' OR
  '/' || replace(lower(s.cwd), char(92), '/') || '/' LIKE '%/var/folders/%')`;

const SESSION_SELECT = `SELECT s.*, f.mtime, ${AUTOMATED} AS automated FROM history_sessions s
  LEFT JOIN history_files f ON f.path = s.file_path`;

interface SessionRow {
  claude_session_id: string;
  cwd: string;
  title: string | null;
  first_ts: string | null;
  last_ts: string | null;
  message_count: number;
  origin: "flightdeck" | "external";
  mtime: string | null;
  automated: number;
}

const isDirectory = (path: string): Promise<boolean> =>
  fileStat(path).then(
    (info) => info.isDirectory(),
    () => false,
  );

const offsetOf = (cursor?: string) => Math.max(0, Number.parseInt(cursor ?? "0", 10) || 0);

/** Reads the history tables of one database. */
export class HistoryQueries {
  constructor(
    private readonly db: Database,
    /** Full-text search through FTS5; `LIKE` otherwise. */
    private readonly fts: boolean,
    /** Clock for `maybeActive`. */
    private readonly now?: () => number,
  ) {}

  /** The folders of the indexed sessions, each once. */
  distinctCwds(): string[] {
    const rows = this.db
      .query("SELECT DISTINCT cwd FROM history_sessions WHERE cwd != ''")
      .all() as Array<{ cwd: string }>;
    return rows.map((r) => r.cwd);
  }

  /** Indexed sessions with at least one message, most recent first. */
  list(filter: HistoryListFilter): {
    sessions: HistorySession[];
    nextCursor: string | null;
    automatedCount: number;
  } {
    const where = ["s.message_count > 0"];
    const limit = filter.limit ?? 50;
    const offset = offsetOf(filter.cursor);
    const params: Record<string, string | number> = { limit: limit + 1, offset };
    if (filter.cwd) {
      where.push(CWD_CONDITION);
      params.cwd = trimSlashes(filter.cwd);
    }
    if (filter.cwds) {
      const names = filter.cwds.map((cwd, i) => {
        params[`cwds${i}`] = cwd;
        return `$cwds${i}`;
      });
      where.push(names.length > 0 ? `s.cwd IN (${names.join(", ")})` : "0");
    }
    // Sessions that overlap the period.
    if (filter.from) {
      where.push("s.last_ts >= $from");
      params.from = filter.from;
    }
    if (filter.to) {
      where.push("s.first_ts <= $to");
      params.to = filter.to;
    }
    if (filter.origin) {
      where.push("s.origin = $origin");
      params.origin = filter.origin;
    }
    const { n: automatedCount } = this.db
      .query(
        `SELECT COUNT(*) AS n FROM history_sessions s WHERE ${where.join(" AND ")} AND ${AUTOMATED}`,
      )
      .get({ ...params, limit: 0, offset: 0 } as never) as { n: number };
    if (filter.hideAutomated) where.push(`NOT ${AUTOMATED}`);
    const rows = this.db
      .query(
        `${SESSION_SELECT} WHERE ${where.join(" AND ")}
         ORDER BY s.last_ts DESC, s.claude_session_id DESC LIMIT $limit OFFSET $offset`,
      )
      .all(params) as SessionRow[];
    return {
      sessions: rows.slice(0, limit).map((r) => this.toSession(r)),
      nextCursor: rows.length > limit ? String(offset + limit) : null,
      automatedCount,
    };
  }

  /** The transcript file the indexer recorded for a Claude session (issue #100), or null. */
  transcriptFile(claudeSessionId: string): string | null {
    const row = this.db
      .query("SELECT file_path FROM history_sessions WHERE claude_session_id = ?")
      .get(claudeSessionId) as { file_path: string | null } | null;
    return row?.file_path ?? null;
  }

  session(claudeSessionId: string): HistorySession | null {
    const row = this.db
      .query(`${SESSION_SELECT} WHERE s.claude_session_id = ?`)
      .get(claudeSessionId) as SessionRow | null;
    return row ? this.toSession(row) : null;
  }

  /**
   * The `index`-th tool call of the message `uuid` with its result (#606), read from the transcript
   * file the indexer recorded for the session: never a path the client names.
   */
  async tool(claudeSessionId: string, uuid: string, index: number): Promise<ToolDetail | null> {
    const row = this.db
      .query("SELECT file_path FROM history_sessions WHERE claude_session_id = ?")
      .get(claudeSessionId) as { file_path: string } | null;
    if (!row) {
      throw new FlightdeckError(
        "not_found",
        `transcript ${claudeSessionId} not indexed`,
        "transcript_not_indexed",
        { id: claudeSessionId },
      );
    }
    return await toolDetail(fileLines(row.file_path), uuid, index);
  }

  /** One page of the readable transcript (messages, summaries and system notes). */
  async get(
    claudeSessionId: string,
    cursor?: string,
    limit = 100,
    tail = false,
  ): Promise<{
    session: HistorySession;
    cwdExists: boolean;
    cursor?: string;
    messages: HistoryMessage[];
    nextCursor: string | null;
    prevCursor: string | null;
  }> {
    const session = this.session(claudeSessionId);
    if (!session) {
      throw new FlightdeckError(
        "not_found",
        `transcript ${claudeSessionId} not indexed`,
        "transcript_not_indexed",
        { id: claudeSessionId },
      );
    }
    // A tail page is the last `limit` readable messages: a transcript opens on its latest.
    const total =
      tail && cursor === undefined
        ? (
            this.db
              .query<{ n: number }, [string]>(
                `SELECT COUNT(*) AS n FROM history_messages WHERE claude_session_id = ? AND kind IN (${READABLE})`,
              )
              .get(claudeSessionId) as { n: number }
          ).n
        : null;
    const offset = total === null ? offsetOf(cursor) : Math.max(0, total - limit);
    const rows = this.db
      .query(
        `SELECT uuid, ts, role, kind, text FROM history_messages
         WHERE claude_session_id = ? AND kind IN (${READABLE})
         ORDER BY rowid LIMIT ? OFFSET ?`,
      )
      .all(claudeSessionId, limit + 1, offset) as HistoryMessage[];
    return {
      session,
      cwdExists: await isDirectory(session.cwd),
      cursor: String(offset),
      messages: rows.slice(0, limit),
      nextCursor: rows.length > limit ? String(offset + limit) : null,
      prevCursor: offset > 0 ? String(Math.max(0, offset - limit)) : null,
    };
  }

  /**
   * What the session lists say about a transcript (phase 8): the first line of the user's last
   * prompt and the last tool called, in file order. `null` when it is not indexed.
   */
  lastActivity(claudeSessionId: string): { request: string | null; tool: string | null } | null {
    const last = (role: "user" | "assistant") =>
      this.db
        .query(
          `SELECT text FROM history_messages
           WHERE claude_session_id = ? AND role = ? AND kind = 'message'
           ORDER BY rowid DESC LIMIT 1`,
        )
        .get(claudeSessionId, role) as { text: string } | null;
    const prompt = last("user");
    const reply = last("assistant");
    if (!prompt && !reply) return null;
    return {
      request: prompt ? requestLine(prompt.text) || null : null,
      tool: reply ? lastTool(reply.text) : null,
    };
  }

  /** What the user wrote in a transcript, message by message in file order (phase 12). */
  userPrompts(claudeSessionId: string): Array<{ uuid: string; text: string }> {
    return this.db
      .query(
        `SELECT uuid, text FROM history_messages
         WHERE claude_session_id = ? AND role = 'user' AND kind = 'message' ORDER BY rowid`,
      )
      .all(claudeSessionId) as Array<{ uuid: string; text: string }>;
  }

  /** The `get` cursor whose page starts at `uuid`. */
  cursorFor(claudeSessionId: string, uuid: string): string {
    const row = this.db
      .query(
        `SELECT COUNT(*) AS n FROM history_messages
         WHERE claude_session_id = $id AND kind IN (${READABLE}) AND rowid <
           (SELECT rowid FROM history_messages WHERE claude_session_id = $id AND uuid = $uuid)`,
      )
      .get({ id: claudeSessionId, uuid }) as { n: number };
    return String(row.n);
  }
  private toSession(row: SessionRow): HistorySession {
    const now = this.now?.() ?? Date.now();
    return {
      claudeSessionId: row.claude_session_id,
      cwd: row.cwd,
      title: row.title,
      firstTs: row.first_ts,
      lastTs: row.last_ts,
      messageCount: row.message_count,
      origin: row.origin,
      maybeActive: row.mtime !== null && now - Date.parse(row.mtime) < MAYBE_ACTIVE_MS,
      automated: row.automated === 1,
    };
  }

  /** Messages containing every term, newest first. */
  search(query: SearchQuery): SearchHit[] {
    return searchMessages(this.db, this.fts, query);
  }
}
