import type { Database } from "bun:sqlite";
import type { SessionMeta } from "@flightdeck/protocol";

interface Row {
  name: string | null;
  pinned: number;
  archived: number;
}

/** Name, pinned and archived of any session (managed or external), keyed by `claudeSessionId`. */
export class SessionMetaStore {
  constructor(private readonly db: Database) {}

  get(claudeSessionId: string): SessionMeta {
    const row = this.db
      .query<Row, [string]>(
        "SELECT name, pinned, archived FROM session_meta WHERE claude_session_id = ?",
      )
      .get(claudeSessionId);
    return {
      name: row?.name ?? null,
      pinned: row?.pinned === 1,
      archived: row?.archived === 1,
    };
  }

  /** Changes only the fields given; `name: null` clears the name. */
  set(claudeSessionId: string, patch: Partial<SessionMeta>): SessionMeta {
    const next = { ...this.get(claudeSessionId), ...patch };
    this.db
      .query(
        `INSERT INTO session_meta (claude_session_id, name, pinned, archived) VALUES (?, ?, ?, ?)
         ON CONFLICT (claude_session_id) DO UPDATE SET name = excluded.name,
           pinned = excluded.pinned, archived = excluded.archived`,
      )
      .run(claudeSessionId, next.name, next.pinned ? 1 : 0, next.archived ? 1 : 0);
    return next;
  }
}
