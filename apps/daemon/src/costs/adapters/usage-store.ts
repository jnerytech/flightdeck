import type { Database } from "bun:sqlite";
import type { FileEdit } from "../domain/transcript-line.ts";

/** A managed session's kind and the project folder of its card, as the database says. */
export interface OwnerRow {
  workflow: string | null;
  card: string | null;
  app: number;
}

/** Where a transcript was read up to, and the folder it named last. */
export interface FileState {
  offset: number;
  cwd: string | null;
}

/** One message's usage, ready to be stored. */
export interface EntryRow {
  id: string;
  session: string;
  at: string;
  day: string;
  key: string;
  model: string;
  origin: string;
  speed: string;
  input: number;
  output: number;
  cacheRead: number;
  cache5m: number;
  cache1h: number;
  cost: number | null;
}

/** A managed session's kind; the project folder of its card when it ran one. */
const OWNER = `SELECT
  (SELECT p.path FROM sessions s JOIN step_runs st ON st.session_id = s.id
     JOIN workflow_runs w ON w.id = st.run_id JOIN cards c ON c.id = w.card_id
     JOIN projects p ON p.id = c.project_id WHERE s.claude_session_id = $id LIMIT 1) AS workflow,
  (SELECT p.path FROM sessions s JOIN card_runs r ON r.session_id = s.id
     JOIN cards c ON c.id = r.card_id JOIN projects p ON p.id = c.project_id
     WHERE s.claude_session_id = $id LIMIT 1) AS card,
  EXISTS (SELECT 1 FROM sessions WHERE claude_session_id = $id) AS app`;

/**
 * The SQLite side of the usage index (#1589): `usage_entries`, `usage_files`, `session_files` and
 * `session_file_edits`. The indexer decides what a message is worth and where a file was read to;
 * this stores what it decided.
 */
export class UsageStore {
  constructor(private readonly db: Database) {}

  /** Usage the daemon spends itself, with no transcript; a record sent twice is one row. */
  insertRecord(row: {
    id: string;
    at: string;
    day: string;
    key: string;
    model: string;
    origin: string;
    speed: string;
    input: number;
    output: number;
    cacheRead: number;
    cache5m: number;
    cache1h: number;
    cost: number | null;
    provider: string | null;
  }): void {
    this.db
      .query(
        `INSERT OR IGNORE INTO usage_entries (message_id, claude_session_id, at, day, project_key,
           model, origin, speed, input, output, cache_read, cache_write_5m, cache_write_1h,
           cost_usd, provider)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.at,
        row.day,
        row.key,
        row.model,
        row.origin,
        row.speed,
        row.input,
        row.output,
        row.cacheRead,
        row.cache5m,
        row.cache1h,
        row.cost,
        row.provider,
      );
  }

  /** The sessions read as the terminal's that a managed session has claimed since. */
  claimedTerminalSessions(): string[] {
    return this.db
      .query<{ id: string }, []>(
        `SELECT DISTINCT claude_session_id AS id FROM usage_entries WHERE origin = 'terminal'
           AND claude_session_id IN (SELECT claude_session_id FROM sessions)`,
      )
      .all()
      .map((row) => row.id);
  }

  /** Gives a claimed session's terminal entries its kind and, when it has one, its project key. */
  reclassify(id: string, origin: string, key: string | null): void {
    this.db
      .query(
        `UPDATE usage_entries SET
           origin = CASE WHEN origin = 'terminal' THEN $origin ELSE origin END,
           project_key = COALESCE($key, project_key)
         WHERE claude_session_id = $id`,
      )
      .run({ id, origin, key });
  }

  owner(claudeSessionId: string): OwnerRow {
    return this.db.query(OWNER).get({ id: claudeSessionId }) as OwnerRow;
  }

  /** Where a transcript was read up to; null when it never was. */
  file(path: string): FileState | null {
    return this.db
      .query<FileState, [string]>("SELECT offset, cwd FROM usage_files WHERE path = ?")
      .get(path);
  }

  /** Everything one slice writes goes in together or not at all. */
  inTransaction(work: () => void): void {
    this.db.transaction(work)();
  }

  /** One message's usage; a message read again counts once. Returns how many rows it added. */
  addEntry(row: EntryRow): number {
    return this.db
      .query(
        `INSERT OR IGNORE INTO usage_entries (message_id, claude_session_id, at, day, project_key,
           model, origin, speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
         VALUES ($id, $session, $at, $day, $key, $model, $origin, $speed, $input, $output,
           $cacheRead, $cache5m, $cache1h, $cost)`,
      )
      .run({ ...row }).changes;
  }

  /** One more write of a file by a session; a tool call read again counts once. */
  recordEdit(claudeSessionId: string, edit: FileEdit, at: string): void {
    const inserted = this.db
      .query(
        `INSERT OR IGNORE INTO session_file_edits (tool_use_id, claude_session_id, path, at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(edit.toolUseId, claudeSessionId, edit.path, at);
    if (inserted.changes === 0) return;
    this.db
      .query(
        `INSERT INTO session_files (claude_session_id, path, edits, first_at, last_at)
         VALUES ($id, $path, 1, $at, $at)
         ON CONFLICT (claude_session_id, path) DO UPDATE SET edits = edits + 1,
           first_at = MIN(first_at, $at), last_at = MAX(last_at, $at)`,
      )
      .run({ id: claudeSessionId, path: edit.path, at });
  }

  /** Where the transcript was read up to, and its size when it was. */
  saveFile(path: string, size: number, offset: number, cwd: string | null): void {
    this.db
      .query(
        `INSERT INTO usage_files (path, size, offset, cwd) VALUES ($path, $size, $offset, $cwd)
         ON CONFLICT(path) DO UPDATE SET size = $size, offset = $offset, cwd = $cwd`,
      )
      .run({ path, size, offset, cwd });
  }
}
