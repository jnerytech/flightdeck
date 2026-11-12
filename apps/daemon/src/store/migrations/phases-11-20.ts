/** Phases 11 to 20: review comments, files, snapshots, approvals, automations, ssh, actions, snippets, secrets and personas. In order: their place in `MIGRATIONS` is their version. */
export const PHASES_11_TO_20: readonly string[] = [
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
];
