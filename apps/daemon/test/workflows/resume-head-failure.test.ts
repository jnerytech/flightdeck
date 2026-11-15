import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import type { Card, Project } from "@flightdeck/protocol";
import { hashOf } from "../../src/workflows/repo.ts";
import { RunResumes, type RunResumesDeps } from "../../src/workflows/resume.ts";
import { poll } from "../support/helpers.ts";

/**
 * A git that cannot answer is a branch that has no HEAD to compare: the resume's checks refuse
 * (the branch moved) instead of throwing, and a recorded run keeps its HEAD column empty.
 */
const DEFINITION = ["steps:", "  - id: a", "    check: fd-check a"].join("\n");
const HASH = hashOf(DEFINITION);
const gone = (): Promise<string | null> => Promise.reject(new Error("git is not available"));

function database(): Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE workflow_runs (
    id TEXT PRIMARY KEY, card_id TEXT, workflow_name TEXT, workflow_hash TEXT, definition TEXT,
    status TEXT, head_at_end TEXT)`);
  db.exec("CREATE TABLE run_resumes (run_id TEXT, n INTEGER, head TEXT)");
  return db;
}

const CARD = {
  id: "card-1",
  projectId: "project-1",
  discarded: false,
  worktreePath: "/work/card-1",
  workflowRunId: "run-1",
} as unknown as Card;

function resumes(db: Database, extra: Partial<RunResumesDeps>) {
  const ended: string[] = [];
  const row = db.query("SELECT * FROM workflow_runs WHERE id = 'run-1'");
  const deps = {
    db,
    host: {
      card: () => CARD,
      acquire: async () => undefined,
      release: () => undefined,
      place: () => undefined,
    },
    store: {
      row: () => row.get(),
      stepRow: () => undefined,
      end: (_id: string, status: string) => ended.push(status),
      setReasonKey: (_id: string, key: string) => ended.push(key),
    },
    registry: {
      source: async () => ({ hash: HASH }),
      trusted: () => true,
    },
    headOf: gone,
    begin: () => undefined,
    cardOrNull: () => CARD,
    ...extra,
  } as unknown as RunResumesDeps;
  return { ended, resumes: new RunResumes(deps) };
}

const PROJECT = { id: "project-1" } as unknown as Project;

function failedRun(db: Database, status: string): void {
  db.query(
    "INSERT INTO workflow_runs (id, card_id, workflow_name, workflow_hash, definition, status, head_at_end) VALUES ('run-1', 'card-1', 'wf', ?, ?, ?, 'abc')",
  ).run(HASH, DEFINITION, status);
}

describe("resume-head-failure: a git that cannot say the HEAD", () => {
  test("a run ending with no HEAD to read records none", async () => {
    const db = database();
    failedRun(db, "failed");
    await resumes(db, {}).resumes.recordHead("run-1", "/work/card-1");
    const head = db.query("SELECT head_at_end AS head FROM workflow_runs WHERE id = 'run-1'").get();
    expect(head).toEqual({ head: null });
  });

  test("a workflow that cannot be read from the base branch is refused as changed", async () => {
    const db = database();
    failedRun(db, "failed");
    const { resumes: runs } = resumes(db, { registry: { source: gone } as never });
    expect(await runs.check("run-1", PROJECT)).toMatchObject({
      ok: false,
      reason: "run_resume_workflow_changed",
    });
  });

  test("a check that cannot read the branch's HEAD says the branch moved", async () => {
    const db = database();
    failedRun(db, "failed");
    expect(await resumes(db, {}).resumes.check("run-1", PROJECT)).toMatchObject({
      ok: false,
      reason: "run_resume_branch_moved",
    });
  });

  test("a queued resume that cannot read the HEAD after the restart fails as moved", async () => {
    const db = database();
    failedRun(db, "queued");
    db.exec("INSERT INTO run_resumes (run_id, n, head) VALUES ('run-1', 1, 'abc')");
    const { ended, resumes: runs } = resumes(db, {});
    runs.recoverQueued();
    await poll(() => ended.length === 2);
    expect(ended).toEqual(["failed", "run_resume_branch_moved"]);
  });
});
