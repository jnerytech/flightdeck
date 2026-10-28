/** Versioned schema migrations, applied in order on boot (tracked by `PRAGMA user_version`). */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE sessions (
    id                TEXT PRIMARY KEY,
    claude_session_id TEXT,
    name              TEXT,
    cwd               TEXT NOT NULL,
    status            TEXT NOT NULL,
    permission_mode   TEXT NOT NULL,
    model             TEXT,
    last_seq          INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );

  CREATE TABLE events (
    session_id TEXT NOT NULL REFERENCES sessions(id),
    seq        INTEGER NOT NULL,
    ts         TEXT NOT NULL,
    type       TEXT NOT NULL,
    payload    TEXT NOT NULL,
    PRIMARY KEY (session_id, seq)
  );

  CREATE TABLE permission_requests (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES sessions(id),
    tool_name   TEXT NOT NULL,
    input       TEXT NOT NULL,
    status      TEXT NOT NULL,
    message     TEXT,
    created_at  TEXT NOT NULL,
    resolved_at TEXT
  );

  CREATE INDEX permission_requests_pending ON permission_requests (status, session_id);
  `,
];
