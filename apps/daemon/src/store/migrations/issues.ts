/** The migrations named after an issue rather than a phase (issue #196 onwards). In order: their place in `MIGRATIONS` is their version. */
export const ISSUES: readonly string[] = [
  // Issue #196: the projects whose own hooks, MCP servers and settings may load in a managed session.
  `
  CREATE TABLE project_trust (
    path       TEXT PRIMARY KEY,
    trusted_at TEXT NOT NULL,
    source     TEXT NOT NULL
  );
  -- What the person already works in keeps loading its own configuration: the projects of the board
  -- and the folders of earlier sessions. A root that is merely allowed is not, nor what is cloned later.
  INSERT OR IGNORE INTO project_trust (path, trusted_at, source)
    SELECT path, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'migration' FROM projects;
  INSERT OR IGNORE INTO project_trust (path, trusted_at, source)
    SELECT DISTINCT cwd, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'migration' FROM sessions;
  `,
  // Issue #196 review: a record covers its folder's tree (`tree`) or only itself (`exact`). The folders
  // of earlier sessions are exact: a session that once ran in a root must not trust every later clone in it.
  `
  ALTER TABLE project_trust ADD COLUMN scope TEXT NOT NULL DEFAULT 'tree';
  UPDATE project_trust SET scope = 'exact'
    WHERE source = 'migration' AND path NOT IN (SELECT path FROM projects);
  `,
  // Home: the failed turns and the time the turns took, next to the cost and the tokens of each day.
  // NULL for the days from before: their outcome and time are unknown, not zero.
  `
  ALTER TABLE usage_daily ADD COLUMN failed_turns INTEGER;
  ALTER TABLE usage_daily ADD COLUMN duration_ms INTEGER;
  `,
  // Issue #150: the resume offer reads the sessions in `error` without scanning them all.
  `
  CREATE INDEX IF NOT EXISTS sessions_status ON sessions (status, updated_at);
  `,
  // Issue #605: the name a session has in Claude Code (a custom-title, else an agent-name), kept
  // apart from the display name so a rename in Flightdeck is told from a title read again.
  `
  CREATE TABLE session_titles (
    session_id TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    kind       TEXT NOT NULL
  );
  `,
  // Issue #101: the team a session works in, its role and a worker's number, so the app names a
  // team session by its persona. NULL for a session of no team.
  `
  ALTER TABLE session_names ADD COLUMN team TEXT;
  ALTER TABLE session_names ADD COLUMN team_role TEXT;
  ALTER TABLE session_names ADD COLUMN team_number INTEGER;
  `,
  // Issue #77: the rounds the person allowed a card's watch on top of the project's maximum.
  `
  ALTER TABLE pr_watch ADD COLUMN extra_rounds INTEGER NOT NULL DEFAULT 0;
  `,
  // Issue #77: the commit a round started from; a round held for drift keeps the commit it was
  // held at and what drifted.
  `
  ALTER TABLE pr_watch_rounds ADD COLUMN base_sha TEXT;
  ALTER TABLE pr_watch_rounds ADD COLUMN held_sha TEXT;
  ALTER TABLE pr_watch_rounds ADD COLUMN drift TEXT;
  `,
  // Issue #78: what each board column of a project asks of a card (a JSON object by column; NULL
  // keeps the defaults).
  `
  ALTER TABLE projects ADD COLUMN contract_by_column TEXT;
  `,
  // Issue #78: the note a person writes about how a card's work was validated.
  `
  ALTER TABLE cards ADD COLUMN validation_note TEXT;
  `,
  // Issue #78: the spec file a card names in its worktree (NULL: docs/specs/<slug>.md), and what
  // the host last found of it (the path it looked at, whether a file was there, its first heading).
  `
  ALTER TABLE cards ADD COLUMN spec_path TEXT;
  ALTER TABLE cards ADD COLUMN spec_checked_path TEXT;
  ALTER TABLE cards ADD COLUMN spec_found INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE cards ADD COLUMN spec_heading TEXT;
  `,
  // Issue #935: the permission mode a terminal session's hooks last reported.
  `
  ALTER TABLE external_sessions ADD COLUMN permission_mode TEXT;
  `,
  // Issue #76: the library documents pinned to a card (a JSON list of paths; NULL: none).
  `
  ALTER TABLE cards ADD COLUMN pinned_docs TEXT;
  `,
  // Issue #79: the stable key of the finding a card was raised from, so a scan does not raise it again.
  `
  ALTER TABLE cards ADD COLUMN source_key TEXT;
  CREATE INDEX cards_source_key ON cards (project_id, source_key);
  `,
  // Issue #78: the spec the host last found says draft: true in its front matter.
  `
  ALTER TABLE cards ADD COLUMN spec_draft INTEGER NOT NULL DEFAULT 0;
  `,
  // Issue #1201: the workflow and the persona a card is meant to start with (from a card template).
  `
  ALTER TABLE cards ADD COLUMN start_workflow TEXT;
  ALTER TABLE cards ADD COLUMN start_persona TEXT;
  `,
  // Issue #1220: the coordinator's last report, the team's outcome, and whether it said done.
  `
  ALTER TABLE teams ADD COLUMN report_text TEXT;
  ALTER TABLE teams ADD COLUMN report_at TEXT;
  ALTER TABLE teams ADD COLUMN report_done INTEGER NOT NULL DEFAULT 0;
  `,
  // Issue #1248: a budget can be a share of a plan quota window (period five_hour or seven_day).
  `
  ALTER TABLE budgets ADD COLUMN limit_pct REAL;
  `,
  // Issue #1266: the HEAD a failed run's worktree had, and each resume of a run.
  `
  ALTER TABLE workflow_runs ADD COLUMN head_at_end TEXT;
  CREATE TABLE run_resumes (
    run_id    TEXT NOT NULL,
    n         INTEGER NOT NULL,
    from_step TEXT NOT NULL,
    reason    TEXT,
    head      TEXT,
    at        TEXT NOT NULL,
    PRIMARY KEY (run_id, n)
  );
  `,
  // Issue #1361: a card's check loop: its switch, cap, confirmation, replay mark and rounds.
  `
  ALTER TABLE cards ADD COLUMN check_loop INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE cards ADD COLUMN check_rounds INTEGER;
  ALTER TABLE cards ADD COLUMN check_loop_confirmed_at TEXT;
  ALTER TABLE cards ADD COLUMN check_loop_confirmed_hash TEXT;
  ALTER TABLE cards ADD COLUMN check_loop_turn_seq INTEGER;
  CREATE TABLE card_check_rounds (
    card_id   TEXT NOT NULL,
    run_id    TEXT NOT NULL,
    n         INTEGER NOT NULL,
    at        TEXT NOT NULL,
    status    TEXT NOT NULL,
    command   TEXT,
    exit_code INTEGER,
    timed_out INTEGER NOT NULL DEFAULT 0,
    summary   TEXT,
    PRIMARY KEY (card_id, run_id, n)
  );
  `,
  // Issue #1352: what the PR poll reads besides the checks: merge state, review state, open date.
  `
  ALTER TABLE cards ADD COLUMN pr_mergeable TEXT;
  ALTER TABLE cards ADD COLUMN pr_review TEXT;
  ALTER TABLE cards ADD COLUMN pr_opened_at TEXT;
  `,
  // Issue #1361: the check loop's rounds keyed by their own id (a loop's end can share its n with
  // its last round), with the end's reason. Rows the table shipped in v0.37.18 are kept, their
  // summary as the reason.
  `
  CREATE TABLE card_check_rounds_v2 (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id   TEXT NOT NULL,
    run_id    TEXT NOT NULL,
    n         INTEGER NOT NULL,
    at        TEXT NOT NULL,
    status    TEXT NOT NULL,
    reason    TEXT,
    command   TEXT,
    exit_code INTEGER,
    timed_out INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO card_check_rounds_v2 (card_id, run_id, n, at, status, reason, command, exit_code, timed_out)
    SELECT card_id, run_id, n, at, status, summary, command, exit_code, timed_out
    FROM card_check_rounds ORDER BY at, n;
  DROP TABLE card_check_rounds;
  ALTER TABLE card_check_rounds_v2 RENAME TO card_check_rounds;
  CREATE INDEX card_check_rounds_card ON card_check_rounds (card_id, id);
  `,
  // Issue #1439: a second opinion's findings among the review drafts, and the card's reviews.
  `
  ALTER TABLE review_comments ADD COLUMN author TEXT;
  ALTER TABLE review_comments ADD COLUMN severity TEXT;
  CREATE TABLE card_reviews (
    card_id   TEXT NOT NULL,
    diff_hash TEXT NOT NULL,
    state     TEXT NOT NULL,
    at        TEXT NOT NULL,
    summary   TEXT,
    loose     TEXT,
    anchored  INTEGER NOT NULL DEFAULT 0,
    moved     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (card_id, diff_hash)
  );
  CREATE TABLE card_review_attempts (
    card_id TEXT NOT NULL,
    at      TEXT NOT NULL
  );
  CREATE INDEX card_review_attempts_card ON card_review_attempts (card_id, at);
  `,
];
