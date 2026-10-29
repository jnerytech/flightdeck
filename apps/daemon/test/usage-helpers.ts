import type { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The session of the usage fixtures (`fixtures/history/usage-*.jsonl`). */
export const SESSION = "aaaaaaaa-0000-4000-8000-000000000001";

const FIXTURES = join(import.meta.dir, "fixtures", "history");

/**
 * A usage fixture with `__CWD__` replaced by `cwd`. With `prefix`, every message id gets it
 * (`msg_A` → `msg_<prefix>A`), so two copies are two different sets of messages.
 */
export function usageFixture(name: string, cwd: string, prefix = ""): string {
  return readFileSync(join(FIXTURES, name), "utf8")
    .replaceAll("__CWD__", JSON.stringify(cwd).slice(1, -1))
    .replaceAll('"id":"msg_', `"id":"msg_${prefix}`);
}

/**
 * `<root>/<dir>/<id>.jsonl` from `usage-main.jsonl` and, unless `subagent` is false,
 * `<root>/<dir>/<id>/subagents/agent-1.jsonl` from `usage-subagent.jsonl`.
 */
export function writeUsageTranscript(
  root: string,
  dir: string,
  cwd: string,
  opts: { id?: string; prefix?: string; subagent?: boolean } = {},
): { main: string; subagent: string } {
  const id = opts.id ?? SESSION;
  const main = join(root, dir, `${id}.jsonl`);
  const subagents = join(root, dir, id, "subagents");
  const subagent = join(subagents, "agent-1.jsonl");
  mkdirSync(subagents, { recursive: true });
  writeFileSync(main, usageFixture("usage-main.jsonl", cwd, opts.prefix));
  if (opts.subagent !== false) {
    writeFileSync(subagent, usageFixture("usage-subagent.jsonl", cwd, opts.prefix));
  }
  return { main, subagent };
}

export interface EntryRow {
  message_id: string;
  claude_session_id: string;
  at: string;
  day: string;
  project_key: string;
  model: string;
  origin: string;
  speed: string;
  input: number;
  output: number;
  cache_read: number;
  cache_write_5m: number;
  cache_write_1h: number;
  cost_usd: number | null;
}

/** Every usage entry, by message id. */
export function usageEntries(db: Database): EntryRow[] {
  return db.query("SELECT * FROM usage_entries ORDER BY message_id").all() as EntryRow[];
}

/** A managed session row (the columns the usage cares about). */
export function insertSession(db: Database, id: string, claudeSessionId: string, cwd: string) {
  db.query(
    `INSERT INTO sessions (id, claude_session_id, cwd, status, permission_mode, created_at, updated_at)
     VALUES (?, ?, ?, 'idle', 'default', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
  ).run(id, claudeSessionId, cwd);
}

/** A project with one card, both with the given ids. */
export function insertCard(db: Database, cardId: string, projectId: string, path: string) {
  db.query(
    `INSERT OR IGNORE INTO projects (id, path, name, base_branch, pr_provider, prompt_template)
     VALUES (?, ?, 'p', 'main', 'none', '')`,
  ).run(projectId, path);
  db.query(
    `INSERT INTO cards (id, project_id, title, description, board_column, position, created_at, updated_at)
     VALUES (?, ?, 't', '', 'doing', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
  ).run(cardId, projectId);
}

/** The card's run went through the managed session `sessionId`. */
export function insertCardRun(db: Database, runId: string, cardId: string, sessionId: string) {
  db.query(
    "INSERT INTO card_runs (id, card_id, session_id, queued_at) VALUES (?, ?, ?, '2026-10-01T00:00:00.000Z')",
  ).run(runId, cardId, sessionId);
}

/** A workflow run of the card whose step `step` ran in the managed session `sessionId`. */
export function insertStepRun(db: Database, runId: string, cardId: string, sessionId: string) {
  db.query(
    `INSERT OR IGNORE INTO workflow_runs (id, card_id, workflow_name, workflow_hash, definition, status,
       budget, usage, inputs, started_at)
     VALUES (?, ?, 'w', 'h', '', 'running', '{}', '{}', '{}', '2026-10-01T00:00:00.000Z')`,
  ).run(runId, cardId);
  db.query(
    `INSERT INTO step_runs (run_id, step_id, attempt, type, status, session_id, started_at)
     VALUES (?, 'step', 1, 'agent', 'running', ?, '2026-10-01T00:00:00.000Z')`,
  ).run(runId, sessionId);
}
