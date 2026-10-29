import type { Database } from "bun:sqlite";
import { normalizeCwd } from "../history/indexer.ts";

export interface SessionFile {
  path: string;
  /** Tool calls that wrote it (Write, Edit, MultiEdit, NotebookEdit). */
  edits: number;
  firstAt: string;
  lastAt: string;
}

export interface FileSession {
  claudeSessionId: string;
  edits: number;
  firstAt: string;
  lastAt: string;
  title: string | null;
}

const caseInsensitive = process.platform === "win32" || process.platform === "darwin";

/** A stored path in the comparable form of `normalizeCwd` (slashes, and case where the OS folds it). */
const COMPARABLE = `${caseInsensitive ? "lower" : ""}(rtrim(replace(f.path, '\\', '/'), '/'))`;

/** Which session wrote which file, from the transcripts (changes made by Bash do not count). */
export class SessionFiles {
  constructor(readonly opts: { db: Database }) {}

  /** The files a session wrote, latest first. */
  list(claudeSessionId: string): SessionFile[] {
    return this.opts.db
      .query<SessionFile, [string]>(
        `SELECT path, edits, first_at AS firstAt, last_at AS lastAt FROM session_files
         WHERE claude_session_id = ? ORDER BY last_at DESC, path`,
      )
      .all(claudeSessionId);
  }

  /** The sessions that wrote a file (an absolute path, compared like the folders), latest first. */
  sessionsOf(path: string): FileSession[] {
    return this.opts.db
      .query<FileSession, [string]>(
        `SELECT f.claude_session_id AS claudeSessionId, f.edits, f.first_at AS firstAt,
           f.last_at AS lastAt,
           COALESCE((SELECT m.name FROM session_meta m WHERE m.claude_session_id = f.claude_session_id),
             h.title) AS title
         FROM session_files f
         LEFT JOIN history_sessions h ON h.claude_session_id = f.claude_session_id
         WHERE ${COMPARABLE} = ? ORDER BY f.last_at DESC`,
      )
      .all(normalizeCwd(path));
  }
}
