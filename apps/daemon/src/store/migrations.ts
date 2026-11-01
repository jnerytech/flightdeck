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
  // Phase 13: a project's issue integration (JSON) and the issue a card came from.
  `
  ALTER TABLE projects ADD COLUMN issues TEXT;
  ALTER TABLE cards ADD COLUMN issue_ref TEXT;
  ALTER TABLE cards ADD COLUMN issue_external INTEGER NOT NULL DEFAULT 0;
  `,
  // Phase 13: automations, their runs, what each one already acted on, and the last minute the
  // scheduler looked at (to tell, at boot, which slots passed while the daemon was stopped).
  `
  CREATE TABLE automations (
    id                     TEXT PRIMARY KEY,
    project_id             TEXT NOT NULL,
    name                   TEXT NOT NULL,
    enabled                INTEGER NOT NULL DEFAULT 0,
    trigger                TEXT NOT NULL,
    action                 TEXT NOT NULL,
    max_runs_per_day       INTEGER NOT NULL DEFAULT 10,
    allow_external_authors INTEGER NOT NULL DEFAULT 0,
    created_at             TEXT NOT NULL
  );

  CREATE TABLE automation_runs (
    id            TEXT PRIMARY KEY,
    automation_id TEXT NOT NULL,
    fired_at      TEXT NOT NULL,
    cause         TEXT NOT NULL,
    status        TEXT NOT NULL,
    detail        TEXT
  );

  CREATE INDEX automation_runs_automation ON automation_runs (automation_id, fired_at);

  CREATE TABLE automation_seen (
    automation_id TEXT NOT NULL,
    key           TEXT NOT NULL,
    PRIMARY KEY (automation_id, key)
  );

  CREATE TABLE automation_clock (
    id        INTEGER PRIMARY KEY CHECK (id = 1),
    last_tick INTEGER NOT NULL
  );
  `,
  // Phase 13: an arena variant is a card of its own (hidden from the board) that points at the
  // card of the arena, with what makes it different (label, model, effort) as JSON.
  `
  ALTER TABLE cards ADD COLUMN arena_of TEXT;
  ALTER TABLE cards ADD COLUMN variant TEXT;
  `,
  // Phase 15: the ssh destinos. `secret_ref` is a key file's path or an item of the vault
  // (phase 16), never a secret; `host_key` is the pinned server key as JSON.
  `
  CREATE TABLE ssh_targets (
    id         TEXT PRIMARY KEY,
    name       TEXT,
    host       TEXT,
    port       INTEGER,
    user       TEXT,
    via_host   TEXT,
    auth       TEXT,
    secret_ref TEXT,
    jump       TEXT,
    options    TEXT,
    tags       TEXT,
    host_key   TEXT,
    created_at TEXT,
    updated_at TEXT
  );
  `,
  // Phase 17: actions made in the app (scope is a project id, or '' for the host), what was
  // trusted of each one (its declaration and the files it executes), and their runs. The output
  // of a run is stored already masked.
  `
  CREATE TABLE actions (
    scope      TEXT NOT NULL,
    name       TEXT NOT NULL,
    definition TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (scope, name)
  );

  CREATE TABLE action_trust (
    scope       TEXT NOT NULL,
    name        TEXT NOT NULL,
    declaration TEXT NOT NULL,
    files       TEXT NOT NULL,
    trusted_at  TEXT NOT NULL,
    PRIMARY KEY (scope, name)
  );

  CREATE TABLE action_runs (
    id           TEXT PRIMARY KEY,
    scope        TEXT NOT NULL,
    name         TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    started_at   TEXT NOT NULL,
    duration_ms  INTEGER NOT NULL,
    exit_code    INTEGER NOT NULL,
    timed_out    INTEGER NOT NULL,
    truncated    INTEGER NOT NULL,
    output       TEXT NOT NULL
  );

  CREATE INDEX action_runs_scope ON action_runs (scope, name);
  `,
  // Phase 18: the snippets kept in the daemon (the host's and a project's own), the marks
  // (favorite, uses, last use) of those and of the ones in a project's versioned file, and the
  // hashes of those files that were trusted to run commands.
  `
  CREATE TABLE snippets (
    id           TEXT PRIMARY KEY,
    scope        TEXT NOT NULL,
    project_path TEXT,
    name         TEXT NOT NULL,
    type         TEXT NOT NULL,
    body         TEXT NOT NULL,
    vars         TEXT NOT NULL,
    tags         TEXT NOT NULL,
    created_at   TEXT,
    updated_at   TEXT
  );

  CREATE INDEX snippets_scope ON snippets (scope, project_path);

  CREATE TABLE snippet_marks (
    id           TEXT PRIMARY KEY,
    favorite     INTEGER NOT NULL DEFAULT 0,
    uses         INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT
  );

  CREATE TABLE snippet_trust (
    project_path TEXT NOT NULL,
    hash         TEXT NOT NULL,
    trusted_at   TEXT,
    PRIMARY KEY (project_path, hash)
  );
  `,
  // Phase 19: one row per request of the daemon for a secret: the rule that decided, the
  // decision, who let it through and how it ended. Never a value; the limits of the rules count it.
  `
  CREATE TABLE vault_decisions (
    id         TEXT PRIMARY KEY,
    at         TEXT NOT NULL,
    at_ms      INTEGER NOT NULL,
    secret_id  TEXT NOT NULL,
    requester  TEXT NOT NULL,
    purpose    TEXT NOT NULL,
    action     TEXT,
    host       TEXT NOT NULL,
    project    TEXT,
    session    TEXT,
    rule_id    TEXT,
    decision   TEXT NOT NULL,
    outcome    TEXT NOT NULL,
    approver   TEXT,
    window     TEXT,
    reason     TEXT NOT NULL
  );

  CREATE INDEX vault_decisions_secret ON vault_decisions (secret_id, requester);
  CREATE INDEX vault_decisions_rule ON vault_decisions (rule_id, at_ms);
  `,
  // Phase 20: the host's personas (the project ones are files) and the hashes of the project
  // ones that were trusted.
  `
  CREATE TABLE personas (
    id         TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE persona_trust (
    project_path TEXT NOT NULL,
    id           TEXT NOT NULL,
    hash         TEXT NOT NULL,
    trusted_at   TEXT,
    PRIMARY KEY (project_path, id, hash)
  );
  `,
  // Phase 20: the persona a session was opened with, kept whole (JSON) because the prompt it
  // appends is not in the transcript and every run of the session has to be given it again.
  `
  ALTER TABLE sessions ADD COLUMN persona TEXT;
  `,
  // Phase 20: the persona applied to an open session (a badge, not a prompt), and, for a terminal
  // session, the one it was opened with.
  `
  ALTER TABLE sessions ADD COLUMN applied_persona TEXT;
  ALTER TABLE external_sessions ADD COLUMN persona_open TEXT;
  ALTER TABLE external_sessions ADD COLUMN persona_applied TEXT;
  `,
  // Phase 20: the default persona of each board column of a project, and the persona a card run
  // was started with (it waits in the queue before the session exists).
  `
  ALTER TABLE projects ADD COLUMN persona_by_column TEXT;
  ALTER TABLE card_runs ADD COLUMN persona TEXT;
  `,
  // Phase 20: which personas a project offers as subagents (all when null).
  `
  ALTER TABLE projects ADD COLUMN persona_subagents TEXT;
  `,
  // Phase 21: the messages between sessions (what the conversations screen shows), the policy of
  // who may talk to whom, and the pairs the loop detector paused.
  `
  CREATE TABLE session_messages (
    id           TEXT PRIMARY KEY,
    from_session TEXT NOT NULL,
    from_host    TEXT NOT NULL,
    to_session   TEXT NOT NULL,
    to_host      TEXT NOT NULL,
    text         TEXT NOT NULL,
    status       TEXT NOT NULL,
    reason       TEXT,
    created_at   TEXT NOT NULL,
    created_ms   INTEGER NOT NULL,
    delivered_at TEXT,
    team_id      TEXT,
    kind         TEXT NOT NULL DEFAULT 'session',
    sender       TEXT,
    untrusted    INTEGER NOT NULL DEFAULT 0,
    relayed      INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX session_messages_pair ON session_messages (from_session, to_session, created_ms);
  CREATE INDEX session_messages_time ON session_messages (created_ms);

  CREATE TABLE messaging_config (
    id     INTEGER PRIMARY KEY CHECK (id = 1),
    policy TEXT NOT NULL
  );

  CREATE TABLE messaging_paused (
    pair TEXT PRIMARY KEY,
    at   TEXT NOT NULL
  );
  `,
  // Phase 21: teams, a coordinator and workers with cards of their own. The members are JSON;
  // the live session of a worker is the one its card is running.
  `
  CREATE TABLE teams (
    id                   TEXT PRIMARY KEY,
    name                 TEXT NOT NULL,
    project_id           TEXT NOT NULL,
    goal                 TEXT NOT NULL,
    coordinator          TEXT,
    members              TEXT NOT NULL,
    checks               TEXT NOT NULL,
    state                TEXT NOT NULL,
    paused_by            TEXT,
    instructions_version TEXT NOT NULL,
    created_at           TEXT NOT NULL
  );

  CREATE INDEX teams_project ON teams (project_id, created_at);
  `,
  // Phase 21, standard session names: the counters only go up (a number is never given twice, and
  // the retention does not touch these tables), and every alias, old ones included, is unique.
  `
  CREATE TABLE session_name_counters (
    project TEXT NOT NULL,
    scope   TEXT NOT NULL,
    last    INTEGER NOT NULL,
    PRIMARY KEY (project, scope)
  );

  CREATE TABLE session_card_numbers (
    card_id TEXT PRIMARY KEY,
    number  INTEGER NOT NULL
  );

  CREATE TABLE session_names (
    session_id  TEXT PRIMARY KEY,
    display     TEXT NOT NULL,
    project     TEXT NOT NULL,
    persona     TEXT NOT NULL,
    number      INTEGER NOT NULL,
    card_number INTEGER,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE session_aliases (
    alias      TEXT PRIMARY KEY,
    session_id TEXT NOT NULL
  );

  CREATE INDEX session_aliases_session ON session_aliases (session_id);
  `,
  `
  CREATE TABLE pr_watch (
    card_id    TEXT PRIMARY KEY,
    enabled    INTEGER,
    snapshot   TEXT,
    -- watching, or needs_you with the reason; the rounds before round_base do not count
    status     TEXT NOT NULL DEFAULT 'watching',
    reason     TEXT,
    round_base INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE pr_watch_rounds (
    id         TEXT PRIMARY KEY,
    card_id    TEXT NOT NULL,
    n          INTEGER NOT NULL,
    status     TEXT NOT NULL,
    trigger    TEXT NOT NULL,
    summary    TEXT,
    session_id TEXT,
    cost_usd   REAL NOT NULL DEFAULT 0,
    turns      INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    ended_at   TEXT
  );

  CREATE INDEX pr_watch_rounds_card ON pr_watch_rounds (card_id);

  ALTER TABLE card_runs ADD COLUMN fix_prompt TEXT;

  CREATE TABLE pr_watch_project (
    project_id TEXT PRIMARY KEY,
    settings   TEXT NOT NULL
  );
  `,
  // Phase 24: the content hashes of a project's run.yaml the user trusted (like the workflows').
  `
  CREATE TABLE trusted_run_configs (
    project_id TEXT NOT NULL REFERENCES projects(id),
    hash       TEXT NOT NULL,
    trusted_at TEXT NOT NULL,
    PRIMARY KEY (project_id, hash)
  );
  `,
  // Phase 24: the block of 10 ports each card holds until it is concluded.
  `
  CREATE TABLE card_ports (
    card_id     TEXT PRIMARY KEY,
    block_start INTEGER NOT NULL UNIQUE
  );
  `,
  // Phase 24: the cards whose run setup already ran (it runs once per card).
  `
  CREATE TABLE card_setup_done (
    card_id TEXT PRIMARY KEY,
    done_at TEXT NOT NULL
  );
  `,
  // Phase 23: the events Claude Code's OTLP exporter sends for terminal sessions (timings, cost,
  // tokens, decisions; never content). `ref` (tool_use_id or request_id) keeps a resent batch
  // from being counted twice.
  `
  CREATE TABLE telemetry_events (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    claude_session_id     TEXT NOT NULL,
    prompt_id             TEXT,
    name                  TEXT NOT NULL,
    at                    INTEGER NOT NULL,
    ref                   TEXT NOT NULL,
    tool_name             TEXT,
    duration_ms           REAL,
    cost_usd              REAL,
    input_tokens          INTEGER,
    output_tokens         INTEGER,
    cache_read_tokens     INTEGER,
    cache_creation_tokens INTEGER,
    success               INTEGER,
    error                 TEXT,
    decision              TEXT,
    source                TEXT
  );

  CREATE UNIQUE INDEX telemetry_events_once ON telemetry_events (claude_session_id, name, at, ref);
  CREATE INDEX telemetry_events_session ON telemetry_events (claude_session_id, at);
  CREATE INDEX telemetry_events_at ON telemetry_events (at);
  `,
];
