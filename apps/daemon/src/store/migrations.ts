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
  // Phase 4: projects and their boards. `cards.notice` and the run id go beyond the spec
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
  `,
  // Phase 5: sessions started outside Flightdeck, seen through Claude Code hooks, and the meta
  // (name, pinned, archived) of any session. `source` goes beyond the spec.
  `
  CREATE TABLE external_sessions (
    claude_session_id TEXT PRIMARY KEY,
    cwd               TEXT,
    transcript_path   TEXT,
    source            TEXT,
    status            TEXT NOT NULL,
    status_reason     TEXT,
    launch_id         TEXT,
    channel_connected INTEGER NOT NULL DEFAULT 0,
    project_key       TEXT,
    started_at        TEXT NOT NULL,
    last_event_at     TEXT NOT NULL,
    ended_at          TEXT
  );

  CREATE INDEX external_sessions_launch ON external_sessions (launch_id);

  CREATE TABLE session_meta (
    claude_session_id TEXT PRIMARY KEY,
    name              TEXT,
    pinned            INTEGER NOT NULL DEFAULT 0,
    archived          INTEGER NOT NULL DEFAULT 0
  );
  `,
  // Phase 6: workflow runs (same id as the card run), their steps and trusted workflows.
  // `definition` (the YAML that ran) and `step_runs.note`/`message`/`usage` go beyond the spec
  // (docs/DECISIONS.md).
  `
  CREATE TABLE workflow_runs (
    id            TEXT PRIMARY KEY,
    card_id       TEXT NOT NULL REFERENCES cards(id),
    workflow_name TEXT NOT NULL,
    workflow_hash TEXT NOT NULL,
    definition    TEXT NOT NULL,
    status        TEXT NOT NULL,
    status_reason TEXT,
    budget        TEXT NOT NULL,
    usage         TEXT NOT NULL,
    inputs        TEXT NOT NULL,
    started_at    TEXT NOT NULL,
    ended_at      TEXT
  );

  CREATE TABLE step_runs (
    run_id     TEXT NOT NULL REFERENCES workflow_runs(id),
    step_id    TEXT NOT NULL,
    attempt    INTEGER NOT NULL,
    type       TEXT NOT NULL,
    status     TEXT NOT NULL,
    session_id TEXT,
    output     TEXT,
    exit_code  INTEGER,
    note       TEXT,
    message    TEXT,
    usage      TEXT,
    started_at TEXT NOT NULL,
    ended_at   TEXT,
    PRIMARY KEY (run_id, step_id, attempt)
  );

  CREATE TABLE trusted_workflows (
    project_id TEXT NOT NULL REFERENCES projects(id),
    name       TEXT NOT NULL,
    hash       TEXT NOT NULL,
    trusted_at TEXT NOT NULL,
    PRIMARY KEY (project_id, name, hash)
  );
  `,
  // Phase 7 (track B): usage of the managed sessions by day (host time zone) and project.
  `
  CREATE TABLE usage_daily (
    day           TEXT NOT NULL,
    project_key   TEXT NOT NULL,
    cost_usd      REAL NOT NULL,
    input_tokens  INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    turns         INTEGER NOT NULL,
    PRIMARY KEY (day, project_key)
  );
  `,
  // Phase 8 (track A): the usage of every assistant message of the transcripts, deduplicated by
  // message id. `usage_files` (each transcript's own read offset) goes beyond the spec.
  `
  CREATE TABLE usage_entries (
    message_id        TEXT PRIMARY KEY,
    claude_session_id TEXT,
    at                TEXT,
    day               TEXT,
    project_key       TEXT,
    model             TEXT,
    origin            TEXT,
    speed             TEXT,
    input             INTEGER,
    output            INTEGER,
    cache_read        INTEGER,
    cache_write_5m    INTEGER,
    cache_write_1h    INTEGER,
    cost_usd          REAL
  );

  CREATE INDEX usage_entries_day ON usage_entries (day);
  CREATE INDEX usage_entries_session ON usage_entries (claude_session_id);

  CREATE TABLE usage_files (
    path   TEXT PRIMARY KEY,
    size   INTEGER NOT NULL,
    offset INTEGER NOT NULL,
    cwd    TEXT
  );
  `,
  // Phase 8 (track A): budgets, and the thresholds each one already crossed per period
  // (`budget_alerts` goes beyond the spec: a restart never alerts twice).
  `
  CREATE TABLE budgets (
    id          TEXT PRIMARY KEY,
    scope       TEXT,
    project_key TEXT,
    period      TEXT,
    limit_usd   REAL,
    action      TEXT,
    created_at  TEXT
  );

  CREATE TABLE budget_alerts (
    budget_id TEXT NOT NULL,
    period    TEXT NOT NULL,
    threshold REAL NOT NULL,
    at        TEXT NOT NULL,
    PRIMARY KEY (budget_id, period, threshold)
  );
  `,
  // Phase 8 (track A): every reading of the plan quota, for its history and projection.
  `
  CREATE TABLE quota_samples (
    window      TEXT,
    utilization REAL,
    resets_at   TEXT,
    status      TEXT,
    taken_at    TEXT
  );

  CREATE INDEX quota_samples_window ON quota_samples (window, taken_at);
  `,
  // Phase 11: inline review comments of a session or card, drafts until sent to the agent.
  `
  CREATE TABLE review_comments (
    id         TEXT PRIMARY KEY,
    target     TEXT,
    path       TEXT,
    side       TEXT,
    line_start INTEGER,
    line_end   INTEGER,
    quote      TEXT,
    body       TEXT,
    state      TEXT,
    created_at TEXT,
    sent_at    TEXT
  );

  CREATE INDEX review_comments_target ON review_comments (target, created_at);
  `,
  // Phase 11: the files each session wrote, from its transcripts. `session_file_edits` (one row
  // per tool call, for deduplication) goes beyond the spec. Clearing `usage_files` makes the
  // usage indexer read every transcript again: usage stays deduplicated by message id, and the
  // files of the transcripts that already existed come in.
  `
  CREATE TABLE session_file_edits (
    tool_use_id       TEXT PRIMARY KEY,
    claude_session_id TEXT NOT NULL,
    path              TEXT NOT NULL,
    at                TEXT NOT NULL
  );

  CREATE TABLE session_files (
    claude_session_id TEXT,
    path              TEXT,
    edits             INTEGER,
    first_at          TEXT,
    last_at           TEXT,
    PRIMARY KEY (claude_session_id, path)
  );

  DELETE FROM usage_files;
  `,
  // Phase 12: git snapshots per turn (refs/flightdeck/snapshots/<session>/<n> in `repo`).
  `
  CREATE TABLE snapshots (
    claude_session_id TEXT NOT NULL,
    n                 INTEGER NOT NULL,
    ref               TEXT NOT NULL,
    tree              TEXT NOT NULL,
    kind              TEXT NOT NULL,
    turn_uuid         TEXT,
    prompt            TEXT,
    created_at        TEXT NOT NULL,
    repo              TEXT NOT NULL,
    PRIMARY KEY (claude_session_id, n)
  );
  `,
  // Phase 13: each project's automatic approval (JSON), its decisions, and the sessions where
  // it is suspended because third-party content reached them.
  `
  ALTER TABLE projects ADD COLUMN auto_approve TEXT;

  CREATE TABLE auto_approvals (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL,
    session_key TEXT NOT NULL,
    request_id  TEXT NOT NULL,
    tool_name   TEXT NOT NULL,
    risk        TEXT NOT NULL,
    decision    TEXT NOT NULL,
    reason      TEXT NOT NULL,
    decided_by  TEXT NOT NULL,
    model       TEXT,
    at          TEXT NOT NULL
  );

  CREATE INDEX auto_approvals_at ON auto_approvals (at);

  CREATE TABLE auto_approve_suspended (
    session_key TEXT PRIMARY KEY,
    reason      TEXT NOT NULL,
    at          TEXT NOT NULL
  );
  `,
];
