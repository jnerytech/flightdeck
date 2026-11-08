import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FlightdeckError } from "../src/errors.ts";
import type { CheckRunner } from "../src/workflows/check-runner.ts";
import { git } from "./board-helpers.ts";
import { durableWorkflowCard, workflowCard } from "./workflow-helpers.ts";

setDefaultTimeout(30_000);

/**
 * Issue #1266, after its review: a resume that cannot be written leaves the run resumable; a
 * resumed run still waiting for its slot when the daemon restarts goes on after it; and a resume
 * that fails once the slot is taken keeps the run's HEAD, so it can be asked about again.
 */
const YAML = [
  "steps:",
  "  - id: a",
  "    check: fd-check a",
  "  - id: b",
  "    check: fd-check b",
].join("\n");

/** a passes; b fails the first time and passes after. */
function scripted() {
  const calls: string[] = [];
  const runner: CheckRunner = {
    run: async (command) => {
      calls.push(command);
      const failing = command.endsWith(" b") && calls.filter((c) => c === command).length === 1;
      return failing ? { exitCode: 1, output: "b broke" } : { exitCode: 0, output: "ok" };
    },
  };
  return { calls, runner };
}

const RESUMES = `CREATE TABLE run_resumes (
  run_id TEXT NOT NULL, n INTEGER NOT NULL, from_step TEXT NOT NULL, reason TEXT, head TEXT,
  at TEXT NOT NULL, PRIMARY KEY (run_id, n))`;

const reasonOf = async (call: () => Promise<unknown>) => {
  try {
    await call();
    return "ok";
  } catch (error) {
    return (error as FlightdeckError).reason ?? String(error);
  }
};

/** A durable host whose run failed at b, then left as a resume waiting for its slot. */
async function waitingAfterRestart(moveBranch: boolean, noHead = false, cardGone = false) {
  const { runner } = scripted();
  const made = await durableWorkflowCard(YAML, { checks: runner });
  const { host } = made;
  await made.runWhen((run) => run.status === "failed");
  const head = host.store.db
    .query<{ head_at_end: string }, [string]>("SELECT head_at_end FROM workflow_runs WHERE id = ?")
    .get(host.runId)?.head_at_end;
  // As `resume` leaves it before its slot comes: the resume recorded, the failed step's rows gone,
  // the run queued.
  host.store.db.query("DELETE FROM step_runs WHERE run_id = ? AND step_id = 'b'").run(host.runId);
  host.store.db
    .query(
      "INSERT INTO run_resumes (run_id, n, from_step, reason, head, at) VALUES (?, 1, 'b', 'b broke', ?, ?)",
    )
    .run(host.runId, noHead ? null : (head ?? null), new Date().toISOString());
  host.store.db
    .query(
      "UPDATE workflow_runs SET status = 'queued', ended_at = NULL, head_at_end = NULL WHERE id = ?",
    )
    .run(host.runId);
  if (moveBranch) {
    const worktree = host.board.getCard(host.cardId).worktreePath ?? "";
    writeFileSync(join(worktree, "later.txt"), "later\n");
    git(worktree, "add", "--", "later.txt");
    git(worktree, "commit", "-q", "-m", "Later");
  }
  // As a card the board no longer has, its run left behind.
  if (cardGone) {
    host.store.db.exec("PRAGMA foreign_keys = OFF");
    host.store.db.query("DELETE FROM cards WHERE id = ?").run(host.cardId);
  }
  await made.restart();
  return { ...made, head };
}

describe("run-resume-harden: a resume after its review (#1266)", () => {
  test("a resume that could not be written leaves the run resumable", async () => {
    const { runner } = scripted();
    const made = await workflowCard(YAML, { board: { checks: runner } });
    await made.start();
    const failed = await made.runWhen((run) => run.status === "failed");
    const runId = failed?.id ?? "";
    made.store.db.exec("DROP TABLE run_resumes");
    const broken = await reasonOf(() => made.board.resumeRun(runId, true));
    made.store.db.exec(RESUMES);
    const again = await made.board.resumeRun(runId, false);
    expect([broken === "ok", again]).toEqual([false, { from: "b", ok: true }]);
  });

  test("a resumed run waiting for its slot goes on after a restart", async () => {
    const { runWhen } = await waitingAfterRestart(false);
    const done = await runWhen((run) => run.status === "completed");
    expect(done?.steps.map((step) => `${step.stepId} ${step.status}`)).toEqual([
      "a completed",
      "b completed",
    ]);
  });

  test("a branch moved while it waited fails it, and keeps its HEAD to say so again", async () => {
    const { host, head, runWhen } = await waitingAfterRestart(true);
    const failed = await runWhen((run) => run.status === "failed");
    const kept = host.store.db
      .query<{ head_at_end: string | null }, [string]>(
        "SELECT head_at_end FROM workflow_runs WHERE id = ?",
      )
      .get(host.runId)?.head_at_end;
    expect([
      failed?.reasonKey,
      kept === head,
      (await host.board.resumeRun(host.runId, false)).reason,
    ]).toEqual(["run_resume_branch_moved", true, "run_resume_branch_moved"]);
  });

  test("a queued resume with no recorded HEAD fails after a restart, and never runs", async () => {
    const { runWhen } = await waitingAfterRestart(false, true);
    const failed = await runWhen((run) => run.status === "failed");
    // b, the step the resume would run, has no row: nothing ran.
    expect([failed?.reasonKey, failed?.steps.map((step) => step.stepId)]).toEqual([
      "run_resume_no_head",
      ["a"],
    ]);
  });

  test("a step whose id looks like an item of the failed one keeps its result: only the failed step's own items go", async () => {
    const calls: string[] = [];
    const runner: CheckRunner = {
      run: async (command) => {
        calls.push(command);
        const failing = command === "fd-check a" && calls.filter((c) => c === command).length === 1;
        return failing ? { exitCode: 1, output: "a broke" } : { exitCode: 0, output: "ok" };
      },
    };
    const dotted = [
      "steps:",
      "  - id: a.1",
      "    check: fd-check a1",
      "  - id: a",
      "    check: fd-check a",
    ].join("\n");
    const made = await workflowCard(dotted, { board: { checks: runner } });
    await made.start();
    const failed = await made.runWhen((run) => run.status === "failed");
    await made.board.resumeRun(failed?.id ?? "", true);
    await made.runWhen((run) => run.status === "completed");
    expect(calls).toEqual(["fd-check a1", "fd-check a", "fd-check a"]);
  });

  test("a queued resume whose card is gone fails after a restart, and the daemon still starts", async () => {
    const made = await waitingAfterRestart(false, false, true);
    const failed = await made.runWhen((run) => run.status === "failed");
    expect(failed?.reasonKey).toBe("run_resume_card");
  });
});
