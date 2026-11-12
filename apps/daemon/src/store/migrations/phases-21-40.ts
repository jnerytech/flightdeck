/** Phases 21 to 40: messages, teams, names, run setup, telemetry, dependencies, the external board, the done-log and providers. In order: their place in `MIGRATIONS` is their version. */
export const PHASES_21_TO_40: readonly string[] = [
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
  // Phase 31: card dependencies. One row per link, in the order the person set them; a card that
  // goes away takes its links with it (the board tells the cards it was holding up).
  `
  CREATE TABLE card_blockers (
    card_id    TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    blocker_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    PRIMARY KEY (card_id, blocker_id)
  );

  CREATE INDEX card_blockers_blocker ON card_blockers (blocker_id);

  ALTER TABLE cards ADD COLUMN unblock_when TEXT NOT NULL DEFAULT 'done';
  ALTER TABLE cards ADD COLUMN auto_start TEXT;
  ALTER TABLE cards ADD COLUMN unblocked_at TEXT;
  -- 1 while the card waits for a blocker: the end of the wait is what unblocks it, once.
  ALTER TABLE cards ADD COLUMN waiting INTEGER NOT NULL DEFAULT 0;
  `,
  // Print-mode (`claude -p`) runs are told apart by the entrypoint Claude Code writes on every
  // line. The files are read once more (the index ignores a line it already has) to fill it in.
  `
  ALTER TABLE history_sessions ADD COLUMN entrypoint TEXT;
  UPDATE history_files SET offset = 0, parse_errors = 0 WHERE claude_session_id IS NOT NULL;
  `,
  // A card notice or a run's end that came from a refusal keeps its reason and params, so the app
  // tells it in its language (the text stays as the fallback for an older app). A new notice
  // takes the old reason away; the writer that has a reason sets it right after the text.
  `
  ALTER TABLE cards ADD COLUMN notice_reason TEXT;
  ALTER TABLE cards ADD COLUMN notice_params TEXT;
  ALTER TABLE workflow_runs ADD COLUMN status_reason_key TEXT;
  ALTER TABLE workflow_runs ADD COLUMN status_reason_params TEXT;

  CREATE TRIGGER cards_notice_reason AFTER UPDATE OF notice ON cards
  WHEN NEW.notice IS NOT OLD.notice
  BEGIN
    UPDATE cards SET notice_reason = NULL, notice_params = NULL WHERE id = NEW.id;
  END;

  CREATE TRIGGER runs_status_reason AFTER UPDATE OF status_reason ON workflow_runs
  WHEN NEW.status_reason IS NOT OLD.status_reason
  BEGIN
    UPDATE workflow_runs SET status_reason_key = NULL, status_reason_params = NULL WHERE id = NEW.id;
  END;
  `,
  // A session keeps the subagents (the personas as `persona-<id>`) it opened with, so a run that
  // reattaches later does not read the persona files again.
  `
  ALTER TABLE sessions ADD COLUMN agents TEXT;
  `,
  // Phase 38: a project linked to an external board, the cards' links to its items, and the
  // log of what a conflict gave up. `local_moved_at` is when the card last changed column here
  // (a trigger sets it; a sync that settles the card clears it).
  `
  CREATE TABLE board_links (
    project_id      TEXT PRIMARY KEY REFERENCES projects(id),
    provider        TEXT NOT NULL,
    board_id        TEXT NOT NULL,
    board_title     TEXT NOT NULL,
    status_field_id TEXT NOT NULL,
    column_map      TEXT NOT NULL,
    push            INTEGER NOT NULL DEFAULT 0,
    cursor          TEXT,
    last_synced_at  TEXT,
    last_error      TEXT,
    truncated       INTEGER NOT NULL DEFAULT 0,
    paused_until    TEXT
  );

  ALTER TABLE cards ADD COLUMN external_id TEXT;
  ALTER TABLE cards ADD COLUMN external_url TEXT;
  ALTER TABLE cards ADD COLUMN external_status TEXT;
  ALTER TABLE cards ADD COLUMN external_updated_at TEXT;
  ALTER TABLE cards ADD COLUMN local_moved_at TEXT;
  ALTER TABLE cards ADD COLUMN external_gone INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX cards_external ON cards (project_id, external_id);

  CREATE TABLE card_sync_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id    TEXT NOT NULL REFERENCES cards(id),
    at         TEXT NOT NULL,
    kind       TEXT NOT NULL,
    winner     TEXT,
    lost_value TEXT,
    lost_at    TEXT,
    kept_value TEXT,
    kept_at    TEXT,
    detail     TEXT
  );
  CREATE INDEX card_sync_log_card ON card_sync_log (card_id, id);

  CREATE TRIGGER cards_local_moved AFTER UPDATE OF board_column ON cards
  WHEN NEW.board_column IS NOT OLD.board_column
  BEGIN
    UPDATE cards SET local_moved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
  END;
  `,
  // Phase 36: the done-log. One row when a card is first done; the cards already in Concluído get an
  // approximate one from their last update. Facts only: no rate, no price, no value.
  `
  CREATE TABLE card_done (
    card_id         TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL,
    done_at         TEXT NOT NULL,
    via             TEXT NOT NULL,
    pr_url          TEXT,
    card_created_at TEXT NOT NULL,
    fix_rounds      INTEGER NOT NULL DEFAULT 0,
    fix_cost_usd    REAL NOT NULL DEFAULT 0,
    approx          INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX card_done_project ON card_done (project_id, done_at);

  INSERT INTO card_done (card_id, project_id, done_at, via, pr_url, card_created_at, approx)
  SELECT id, project_id, updated_at, 'moved', pr_url, created_at, 1 FROM cards WHERE board_column = 'done';
  `,
  // Phase 36: how many hours a card is worth (an estimate the person types), and a default per project.
  `
  ALTER TABLE cards ADD COLUMN estimate_hours REAL;
  ALTER TABLE projects ADD COLUMN default_hours REAL;
  `,
  // Phase 36: the optional value signals a project switched on; both off by default.
  `
  ALTER TABLE projects ADD COLUMN roi_commits INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE projects ADD COLUMN roi_issues INTEGER NOT NULL DEFAULT 0;
  `,
  // Phase 39: the agent a session runs on; every session before it is Claude's.
  `
  ALTER TABLE sessions ADD COLUMN runtime TEXT NOT NULL DEFAULT 'claude';
  `,
  // Phase 40: which provider answered an assistant call; NULL for every other row.
  `
  ALTER TABLE usage_entries ADD COLUMN provider TEXT;
  `,
];
