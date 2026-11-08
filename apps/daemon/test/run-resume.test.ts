import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FlightdeckError } from "../src/errors.ts";
import { startServer } from "../src/server.ts";
import type { CheckRunner } from "../src/workflows/check-runner.ts";
import { git } from "./board-helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { commitWorkflow, workflowCard } from "./workflow-helpers.ts";

setDefaultTimeout(30_000);

/**
 * Issue #1266: a failed workflow run resumes from its failed step, in place. The steps before it
 * give back what they stored and do not run again; a changed workflow file, a moved branch, a run
 * with no recorded HEAD or one that did not fail refuses the resume with its reason.
 */
const YAML = [
  "steps:",
  "  - id: a",
  "    check: fd-check a",
  "  - id: b",
  "    check: fd-check b",
  "  - id: c",
  "    check: fd-check c",
  "  - id: d",
  "    check: fd-check d",
].join("\n");

/**
 * a, b and d pass; c fails the first time and passes after. With `hold`, the second run of c
 * waits for it: the resumed run stays going while the test acts.
 */
function scripted(hold?: Promise<void>) {
  const calls: string[] = [];
  const runner: CheckRunner = {
    run: async (command) => {
      calls.push(command);
      const name = command.split(" ").at(-1) ?? "";
      const runs = calls.filter((call) => call === command).length;
      if (hold && name === "c" && runs === 2) await hold;
      const failing = name === "c" && runs === 1;
      return failing
        ? { exitCode: 1, output: "c broke" }
        : { exitCode: 0, output: name.toUpperCase() };
    },
  };
  return { calls, runner };
}

async function failedAtC(hold?: Promise<void>) {
  const { calls, runner } = scripted(hold);
  const made = await workflowCard(YAML, { board: { checks: runner } });
  await made.start();
  const failed = await made.runWhen((run) => run.status === "failed");
  return { ...made, calls, runId: failed?.id ?? "" };
}

const refusal = async (call: () => Promise<unknown>) => {
  try {
    await call();
    return "ok";
  } catch (error) {
    return (error as FlightdeckError).reason ?? String(error);
  }
};

describe("run-resume: a failed run resumes from its failed step (#1266)", () => {
  test("a run that failed at step 3 of 4 resumes at 3 with steps 1 and 2's outputs, which do not run again", async () => {
    const { board, calls, runId, runWhen } = await failedAtC();
    const offered = await board.resumeRun(runId, false);
    await board.resumeRun(runId, true);
    const done = await runWhen((run) => run.status === "completed");
    expect([
      offered,
      done?.id,
      calls.map((call) => call.split(" ").at(-1)),
      done?.steps.map((step) => `${step.stepId} ${step.status} ${step.output}`),
    ]).toEqual([
      { from: "c", ok: true },
      runId,
      ["a", "b", "c", "c", "d"],
      ["a completed A", "b completed B", "c completed C", "d completed D"],
    ]);
  });

  test("a changed workflow file refuses the resume, with its reason, on the offer and on the confirm", async () => {
    const { board, repo, runId } = await failedAtC();
    commitWorkflow(repo, "wf", `${YAML}\n  - id: e\n    check: fd-check e\n`);
    expect([
      await board.resumeRun(runId, false),
      await refusal(() => board.resumeRun(runId, true)),
    ]).toEqual([
      { from: "c", ok: false, reason: "run_resume_workflow_changed", params: { name: "wf" } },
      "run_resume_workflow_changed",
    ]);
  });

  test("a branch moved since the run ended, a run with no recorded HEAD, and a run that did not fail are refused", async () => {
    const moved = await failedAtC();
    const worktree = moved.board.getCard(moved.card.id).worktreePath ?? "";
    writeFileSync(join(worktree, "later.txt"), "later\n");
    git(worktree, "add", "--", "later.txt");
    git(worktree, "commit", "-q", "-m", "Later");
    const old = await failedAtC();
    // As a run that ended before the column was there.
    old.store.db.query("UPDATE workflow_runs SET head_at_end = NULL WHERE id = ?").run(old.runId);
    const done = await failedAtC();
    await done.board.resumeRun(done.runId, true);
    await done.runWhen((run) => run.status === "completed");
    expect([
      (await moved.board.resumeRun(moved.runId, false)).reason,
      (await old.board.resumeRun(old.runId, false)).reason,
      (await done.board.resumeRun(done.runId, false)).reason,
      await refusal(() => old.board.resumeRun(old.runId, true)),
    ]).toEqual([
      "run_resume_branch_moved",
      "run_resume_no_head",
      "run_resume_not_failed",
      "run_resume_no_head",
    ]);
  });

  test("over the protocol, the check answers anywhere, and only a near connection resumes", async () => {
    const { board, manager, root, runId, runWhen } = await failedAtC();
    const token = "run-resume-token-0123456789abcd";
    const base = {
      manager,
      board,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token,
      allowedRoots: [root],
      allowedNetworks: ["0.0.0.0/0", "::/0"],
    };
    const servers = [startServer(base), startServer({ ...base, peerOf: () => "8.8.8.8" })];
    const clients = servers.map((server) => new FrameClient(server.url));
    try {
      for (const client of clients) await client.request("hello", { token, client: "t" });
      const [near, far] = clients as [FrameClient, FrameClient];
      const send = async (client: FrameClient, confirm: boolean) => {
        const ack = await client.request("run.resume", { runId, ...(confirm ? { confirm } : {}) });
        const error = ack.error as { reason?: string } | undefined;
        return ack.ok === true ? ack.data : (error?.reason ?? null);
      };
      const checked = await send(far, false);
      const refused = await send(far, true);
      const resumed = await send(near, true);
      const done = await runWhen((run) => run.status === "completed");
      expect([checked, refused, resumed, done?.status]).toEqual([
        { from: "c", ok: true },
        "transport_refused",
        { from: "c", ok: true },
        "completed",
      ]);
    } finally {
      for (const client of clients) client.close();
      for (const server of servers) await server.stop();
    }
  });

  test("a tampered stored definition refuses; two resumes at once run the steps once; a start meanwhile is refused", async () => {
    const tampered = await failedAtC();
    tampered.store.db
      .query(
        "UPDATE workflow_runs SET definition = replace(definition, 'fd-check d', 'fd-check evil') WHERE id = ?",
      )
      .run(tampered.runId);
    let release = () => {};
    const twice = await failedAtC(new Promise<void>((done) => (release = done)));
    const both = await Promise.all([
      refusal(() => twice.board.resumeRun(twice.runId, true)),
      refusal(() => twice.board.resumeRun(twice.runId, true)),
    ]);
    // The resumed run is going (c held): a start now is refused, then c is let go.
    await twice.runWhen((run) =>
      run.steps.some((step) => step.stepId === "c" && step.status === "running"),
    );
    const started = await refusal(() => twice.start());
    release();
    await twice.runWhen((run) => run.status === "completed");
    expect([
      (await tampered.board.resumeRun(tampered.runId, false)).reason,
      both.filter((outcome) => outcome === "ok").length,
      started,
      twice.calls.map((call) => call.split(" ").at(-1)),
    ]).toEqual(["run_resume_workflow_changed", 1, "card_queued", ["a", "b", "c", "c", "d"]]);
  });
});
