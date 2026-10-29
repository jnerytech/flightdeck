import type { Database } from "bun:sqlite";
import { statSync } from "node:fs";

export type ExternalStatus = "idle" | "running" | "awaiting_permission" | "ended" | "unknown";

export interface ExternalSession {
  claudeSessionId: string;
  cwd: string | null;
  transcriptPath: string | null;
  /** `startup`, `resume`, `clear` or `compact`, from SessionStart. */
  source: string | null;
  status: ExternalStatus;
  statusReason: string | null;
  /** Set by `flightdeckd claude`; the channel of that launch follows its current session. */
  launchId: string | null;
  /** A channel is connected for it: the app can send it messages. */
  controllable: boolean;
  projectKey: string | null;
  startedAt: string;
  lastEventAt: string;
  endedAt: string | null;
}

export type HookPayload = Record<string, unknown>;

export interface Timers {
  setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(id: ReturnType<typeof setInterval>): void;
}

export interface ExternalSessionsOptions {
  db: Database;
  /** No event and no transcript change for this long: `ended` with reason `stale`. */
  staleAfterS: number;
  now?: () => number;
  projectKey?: (cwd: string) => string;
}

interface Row {
  claude_session_id: string;
  cwd: string | null;
  transcript_path: string | null;
  source: string | null;
  status: ExternalStatus;
  status_reason: string | null;
  launch_id: string | null;
  channel_connected: number;
  project_key: string | null;
  started_at: string;
  last_event_at: string;
  ended_at: string | null;
}

/** State after each hook event (docs/SPEC-fase-5.md); Notification depends on its type. */
const NEXT: Record<string, ExternalStatus> = {
  SessionStart: "idle",
  UserPromptSubmit: "running",
  PermissionRequest: "awaiting_permission",
  PostToolUse: "running",
  PostToolUseFailure: "running",
  PermissionDenied: "running",
  Stop: "idle",
  SessionEnd: "ended",
};

const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);

function nextStatus(event: string, payload: HookPayload): ExternalStatus | null {
  if (event !== "Notification") return NEXT[event] ?? null;
  return payload.notification_type === "permission_prompt" ? "awaiting_permission" : null;
}

const toSession = (row: Row): ExternalSession => ({
  claudeSessionId: row.claude_session_id,
  cwd: row.cwd,
  transcriptPath: row.transcript_path,
  source: row.source,
  status: row.status,
  statusReason: row.status_reason,
  launchId: row.launch_id,
  controllable: row.channel_connected === 1,
  projectKey: row.project_key,
  startedAt: row.started_at,
  lastEventAt: row.last_event_at,
  endedAt: row.ended_at,
});

/** Last modification of a transcript, or 0 when it is unreadable. */
function mtimeOf(path: string | null): number {
  try {
    return statSync(path ?? "").mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * The live sessions of this host started outside Flightdeck, fed by Claude Code hooks. After a
 * restart, what had not ended is `unknown` until its next event, and no channel is connected.
 */
export class ExternalSessions {
  private readonly db: Database;
  private readonly now: () => number;
  private readonly listeners = new Set<(session: ExternalSession) => void>();
  /** Launch ids with a channel connected right now. */
  private readonly channels = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private timers: Timers = globalThis;

  constructor(private readonly opts: ExternalSessionsOptions) {
    this.db = opts.db;
    this.now = opts.now ?? Date.now;
    this.db.exec(
      "UPDATE external_sessions SET status = 'unknown', status_reason = NULL WHERE status <> 'ended'",
    );
    this.db.exec("UPDATE external_sessions SET channel_connected = 0");
  }

  /** Applies one hook event; `null` when it names no session. */
  apply(event: string, payload: HookPayload): ExternalSession | null {
    const id = text(payload.session_id);
    if (!id) return null;
    const at = new Date(this.now()).toISOString();
    const next = nextStatus(event, payload);
    const cwd = text(payload.cwd);
    if (!this.get(id)) {
      this.db
        .query(
          `INSERT INTO external_sessions (claude_session_id, status, started_at, last_event_at)
           VALUES (?, 'unknown', ?, ?)`,
        )
        .run(id, at, at);
    }
    this.db
      .query(
        `UPDATE external_sessions SET cwd = COALESCE(?, cwd), transcript_path = COALESCE(?, transcript_path),
           project_key = COALESCE(?, project_key), status = COALESCE(?, status), status_reason = ?,
           last_event_at = ?, ended_at = CASE WHEN ? = 'ended' THEN ? ELSE ended_at END
         WHERE claude_session_id = ?`,
      )
      .run(
        cwd,
        text(payload.transcript_path),
        cwd ? (this.opts.projectKey?.(cwd) ?? null) : null,
        next,
        event === "SessionEnd" ? text(payload.reason) : null,
        at,
        next,
        at,
        id,
      );
    if (event === "SessionStart") this.started(id, payload);
    return this.emit(id);
  }

  /** A new session of a launch (after /clear, /compact or --resume) takes over its channel. */
  private started(id: string, payload: HookPayload): void {
    const launch = text(payload.launch_id);
    this.db
      .query("UPDATE external_sessions SET source = ?, launch_id = ? WHERE claude_session_id = ?")
      .run(text(payload.source), launch, id);
    if (!launch) return;
    this.db
      .query(
        `UPDATE external_sessions SET channel_connected = CASE WHEN claude_session_id = ? THEN ? ELSE 0 END
         WHERE launch_id = ?`,
      )
      .run(id, this.channels.has(launch) ? 1 : 0, launch);
  }

  get(id: string): ExternalSession | null {
    const row = this.db
      .query<Row, [string]>("SELECT * FROM external_sessions WHERE claude_session_id = ?")
      .get(id);
    return row ? toSession(row) : null;
  }

  /** Most recent activity first. */
  list(): ExternalSession[] {
    return this.db
      .query<Row, []>("SELECT * FROM external_sessions ORDER BY last_event_at DESC, rowid DESC")
      .all()
      .map(toSession);
  }

  /** Current session of a launch: the latest one started with that launch id. */
  sessionForLaunch(launchId: string): string | null {
    const row = this.db
      .query<{ claude_session_id: string }, [string]>(
        `SELECT claude_session_id FROM external_sessions WHERE launch_id = ?
         ORDER BY started_at DESC, rowid DESC LIMIT 1`,
      )
      .get(launchId);
    return row?.claude_session_id ?? null;
  }

  /** A channel of `flightdeckd claude` connected or left. */
  setChannel(launchId: string, connected: boolean): void {
    if (connected) this.channels.add(launchId);
    else this.channels.delete(launchId);
    const id = this.sessionForLaunch(launchId);
    if (!id) return;
    this.db
      .query("UPDATE external_sessions SET channel_connected = ? WHERE claude_session_id = ?")
      .run(connected ? 1 : 0, id);
    this.emit(id);
  }

  /** Ends sessions with no event and no transcript change for `staleAfterS`. */
  sweep(): void {
    const now = this.now();
    const limit = now - this.opts.staleAfterS * 1000;
    const quiet = this.db
      .query<Row, [string]>(
        "SELECT * FROM external_sessions WHERE status <> 'ended' AND last_event_at < ?",
      )
      .all(new Date(limit).toISOString());
    for (const row of quiet) {
      if (mtimeOf(row.transcript_path) >= limit) continue;
      this.db
        .query(
          `UPDATE external_sessions SET status = 'ended', status_reason = 'stale', ended_at = ?
           WHERE claude_session_id = ?`,
        )
        .run(new Date(now).toISOString(), row.claude_session_id);
      this.emit(row.claude_session_id);
    }
  }

  start(intervalMs: number, timers: Timers = globalThis): void {
    this.timers = timers;
    this.timer = timers.setInterval(() => this.sweep(), intervalMs);
  }

  stop(): void {
    if (this.timer) this.timers.clearInterval(this.timer);
    this.timer = null;
  }

  onChange(listener: (session: ExternalSession) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(id: string): ExternalSession {
    const session = this.get(id) as ExternalSession;
    for (const listener of this.listeners) listener(session);
    return session;
  }
}
