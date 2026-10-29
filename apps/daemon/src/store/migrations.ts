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
  // Phase 3: transcripts indexed from ~/.claude/projects. The FTS table depends on FTS5 being
  // available, so the history index creates it at boot (see history/indexer.ts).
  `
  CREATE TABLE history_files (
    path              TEXT PRIMARY KEY,
    claude_session_id TEXT,
    size              INTEGER,
    mtime             TEXT,
    offset            INTEGER,
    parse_errors      INTEGER
  );

  CREATE TABLE history_sessions (
    claude_session_id TEXT PRIMARY KEY,
    cwd               TEXT,
    title             TEXT,
    first_ts          TEXT,
    last_ts           TEXT,
    message_count     INTEGER,
    origin            TEXT,
    file_path         TEXT
  );

  CREATE TABLE history_messages (
    claude_session_id TEXT,
    uuid              TEXT,
    ts                TEXT,
    role              TEXT,
    kind              TEXT,
    text              TEXT,
    PRIMARY KEY (claude_session_id, uuid)
  );
  `,
  // Phase 4: projects and their boards. `notice` and `board_settings` go beyond the spec
  // (see docs/DECISIONS.md).
  `
  CREATE TABLE projects (
    id              TEXT PRIMARY KEY,
    path            TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    base_branch     TEXT NOT NULL,
    pr_provider     TEXT NOT NULL,
    setup_script    TEXT,
    prompt_template TEXT NOT NULL
  );

  CREATE TABLE cards (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL REFERENCES projects(id),
    title         TEXT NOT NULL,
    description   TEXT NOT NULL,
    board_column  TEXT NOT NULL,
    column_locked INTEGER NOT NULL DEFAULT 0,
    position      REAL NOT NULL,
    slug          TEXT,
    branch        TEXT,
    worktree_path TEXT,
    pr_url        TEXT,
    pr_state      TEXT,
    checks_state  TEXT,
    notice        TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  -- Own id instead of (card_id, session_id): a queued or preparing run has no session yet,
  -- and one that failed before the session never gets one.
  CREATE TABLE card_runs (
    id         TEXT PRIMARY KEY,
    card_id    TEXT NOT NULL REFERENCES cards(id),
    session_id TEXT,
    queued_at  TEXT NOT NULL,
    started_at TEXT,
    ended_at   TEXT
  );

  CREATE INDEX card_runs_card ON card_runs (card_id);

  CREATE TABLE board_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];
