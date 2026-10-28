import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  EPHEMERAL_EVENTS,
  type EventEnvelope,
  type PermissionMode,
  SessionEvent,
  type SessionStatus,
  type SessionSummary,
  type ToolInput,
} from "@flightdeck/protocol";
import { MIGRATIONS } from "./migrations.ts";

export type PermissionStatus = "pending" | "allowed" | "denied" | "cancelled" | "expired";

export interface PermissionRecord {
  id: string;
  sessionId: string;
  toolName: string;
  input: ToolInput;
  status: PermissionStatus;
  message: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface NewSession {
  id: string;
  name: string | null;
  cwd: string;
  status: SessionStatus;
  permissionMode: PermissionMode;
  model: string | null;
}

interface SessionRow {
  id: string;
  claude_session_id: string | null;
  name: string | null;
  cwd: string;
  status: SessionStatus;
  permission_mode: PermissionMode;
  model: string | null;
  last_seq: number;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  session_id: string;
  seq: number;
  ts: string;
  payload: string;
}

interface PermissionRow {
  id: string;
  session_id: string;
  tool_name: string;
  input: string;
  status: PermissionStatus;
  message: string | null;
  created_at: string;
  resolved_at: string | null;
}

const now = () => new Date().toISOString();

function toSummary(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    name: row.name,
    cwd: row.cwd,
    status: row.status,
    permissionMode: row.permission_mode,
    model: row.model,
    claudeSessionId: row.claude_session_id,
    lastSeq: row.last_seq,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPermission(row: PermissionRow): PermissionRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    toolName: row.tool_name,
    input: JSON.parse(row.input) as ToolInput,
    status: row.status,
    message: row.message,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

/**
 * SQLite-backed event log plus derived session and permission state. The event log is the
 * source of truth; every persisted event gets a per-session `seq` assigned in the same
 * transaction that bumps `sessions.last_seq`.
 */
export class EventStore {
  readonly db: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  private migrate(): void {
    const { user_version: current } = this.db.query("PRAGMA user_version").get() as {
      user_version: number;
    };
    for (const [index, sql] of MIGRATIONS.entries()) {
      const version = index + 1;
      if (version <= current) continue;
      this.db.transaction(() => {
        this.db.exec(sql);
        this.db.exec(`PRAGMA user_version = ${version}`);
      })();
    }
  }

  close(): void {
    this.db.close();
  }

  // -- sessions -------------------------------------------------------------

  createSession(session: NewSession): SessionSummary {
    const ts = now();
    this.db
      .query(
        `INSERT INTO sessions (id, name, cwd, status, permission_mode, model, last_seq, created_at, updated_at)
         VALUES ($id, $name, $cwd, $status, $permissionMode, $model, 0, $ts, $ts)`,
      )
      .run({ ...session, ts });
    return this.requireSession(session.id);
  }

  getSession(id: string): SessionSummary | null {
    const row = this.db.query("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | null;
    return row ? toSummary(row) : null;
  }

  requireSession(id: string): SessionSummary {
    const session = this.getSession(id);
    if (!session) throw new Error(`session ${id} not found`);
    return session;
  }

  listSessions(): SessionSummary[] {
    const rows = this.db
      .query("SELECT * FROM sessions ORDER BY created_at DESC, id DESC")
      .all() as SessionRow[];
    return rows.map(toSummary);
  }

  updateSession(
    id: string,
    patch: { status?: SessionStatus; claudeSessionId?: string; model?: string },
  ): void {
    this.db
      .query(
        `UPDATE sessions SET
           status = COALESCE($status, status),
           claude_session_id = COALESCE($claudeSessionId, claude_session_id),
           model = COALESCE($model, model),
           updated_at = $ts
         WHERE id = $id`,
      )
      .run({
        id,
        status: patch.status ?? null,
        claudeSessionId: patch.claudeSessionId ?? null,
        model: patch.model ?? null,
        ts: now(),
      });
  }

  // -- events ---------------------------------------------------------------

  /**
   * Validates and appends an event. Persistent events get the next `seq`; ephemeral ones
   * (`message.delta`) are not stored and carry the current `last_seq`.
   */
  appendEvent(sessionId: string, event: SessionEvent): EventEnvelope {
    const parsed = SessionEvent.parse(event);
    const ts = now();
    if (EPHEMERAL_EVENTS.has(parsed.type)) {
      const { lastSeq } = this.requireSession(sessionId);
      return { type: "event", sessionId, seq: lastSeq, ts, event: parsed };
    }
    const seq = this.db.transaction(() => {
      const row = this.db
        .query(
          "UPDATE sessions SET last_seq = last_seq + 1, updated_at = ? WHERE id = ? RETURNING last_seq",
        )
        .get(ts, sessionId) as { last_seq: number } | null;
      if (!row) throw new Error(`session ${sessionId} not found`);
      this.db
        .query("INSERT INTO events (session_id, seq, ts, type, payload) VALUES (?, ?, ?, ?, ?)")
        .run(sessionId, row.last_seq, ts, parsed.type, JSON.stringify(parsed));
      return row.last_seq;
    })();
    return { type: "event", sessionId, seq, ts, event: parsed };
  }

  eventsSince(sessionId: string, sinceSeq = 0): EventEnvelope[] {
    const rows = this.db
      .query(
        "SELECT session_id, seq, ts, payload FROM events WHERE session_id = ? AND seq > ? ORDER BY seq",
      )
      .all(sessionId, sinceSeq) as EventRow[];
    return rows.map((row) => ({
      type: "event",
      sessionId: row.session_id,
      seq: row.seq,
      ts: row.ts,
      event: SessionEvent.parse(JSON.parse(row.payload)),
    }));
  }

  // -- permission requests --------------------------------------------------

  createPermission(record: {
    id: string;
    sessionId: string;
    toolName: string;
    input: ToolInput;
  }): PermissionRecord {
    this.db
      .query(
        `INSERT INTO permission_requests (id, session_id, tool_name, input, status, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?)`,
      )
      .run(record.id, record.sessionId, record.toolName, JSON.stringify(record.input), now());
    return this.getPermission(record.id) as PermissionRecord;
  }

  getPermission(id: string): PermissionRecord | null {
    const row = this.db
      .query("SELECT * FROM permission_requests WHERE id = ?")
      .get(id) as PermissionRow | null;
    return row ? toPermission(row) : null;
  }

  /** Moves a pending request to a final status. Returns false if it was no longer pending. */
  resolvePermission(
    id: string,
    status: Exclude<PermissionStatus, "pending">,
    message?: string,
  ): boolean {
    const result = this.db
      .query(
        `UPDATE permission_requests SET status = ?, message = ?, resolved_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(status, message ?? null, now(), id);
    return result.changes > 0;
  }

  pendingPermissions(sessionId?: string): PermissionRecord[] {
    const rows = (
      sessionId
        ? this.db
            .query(
              "SELECT * FROM permission_requests WHERE status = 'pending' AND session_id = ? ORDER BY created_at",
            )
            .all(sessionId)
        : this.db
            .query("SELECT * FROM permission_requests WHERE status = 'pending' ORDER BY created_at")
            .all()
    ) as PermissionRow[];
    return rows.map(toPermission);
  }
}
