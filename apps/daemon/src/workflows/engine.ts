import type { Database } from "bun:sqlite";
import type { RunResumeCheck, RunStatus, WorkflowInfo, WorkflowRun } from "@flightdeck/protocol";
import { inSequence } from "@flightdeck/protocol";
import { refArg } from "../board/ref-arg.ts";
import type { Card, Project } from "../board/types.ts";
import { git } from "../git/index.ts";
import { FlightdeckError } from "../kernel/index.ts";
import { withoutPersonas } from "../personas/index.ts";
import { noSpending } from "./budget.ts";
import {
  type EngineHost,
  now,
  type RunRow,
  reason,
  type StepRow,
  toStep,
  type WorkflowEngineOptions,
} from "./engine-types.ts";
import { hashOf, type WorkflowSource, workflowSources } from "./repo.ts";
import * as col from "./row-json.ts";
import { checkCommands, parseWorkflow, type Workflow } from "./schema.ts";
import { StepRunner } from "./step-runner.ts";

/** #1266: the rows the engine names after a step: a parallel's items, a loop's check and do. */
function childrenOf(definition: string, stepId: string): Set<string> {
  const step = parseWorkflow(definition).workflow?.steps.find((s) => s.id === stepId);
  if (!step) return new Set();
  if ("parallel" in step) return new Set(step.parallel.map((_, i) => `${stepId}.${i}`));
  if ("loop" in step) return new Set([`${stepId}.check`, `${stepId}.do`]);
  return new Set();
}

/** The commit a worktree's HEAD is at, from git; null when it cannot say. */
async function gitHead(worktree: string): Promise<string | null> {
  const found = await git(worktree, "rev-parse", "--verify", "--quiet", "HEAD");
  return found.code === 0 ? found.stdout.trim() : null;
}

const ACTIVE: ReadonlySet<RunStatus> = new Set(["queued", "running", "waiting"]);

/** Workflows of the projects: catalog read from the base branch, trust and runs. */
export class WorkflowEngine {
  private readonly db: Database;
  private readonly manager: WorkflowEngineOptions["manager"];
  private readonly host: EngineHost;
  private readonly headOf: (worktree: string) => Promise<string | null>;
  /** #1266: the runs being resumed right now: a second resume of one is refused. */
  private readonly resuming = new Set<string>();
  /** Open gates of this process, by `run/step/attempt`: wakes the run when answered. */
  private readonly gates = new Map<string, () => void>();
  private readonly watchers = new Set<(run: WorkflowRun) => void>();
  /** Runs waiting for the plan quota before an agent turn: until when (ms), if known. */
  private readonly quotaWaits = new Map<string, number | null>();
  /** #1595: the steps of a run, executed with the engine's stores and state. */
  private readonly steps: StepRunner;

  constructor(opts: WorkflowEngineOptions) {
    this.db = opts.db;
    this.manager = opts.manager;
    this.host = opts.host;
    this.headOf = opts.headOf ?? gitHead;
    this.steps = new StepRunner({
      db: this.db,
      manager: this.manager,
      preparePersonas: opts.preparePersonas ?? withoutPersonas,
      host: this.host,
      checks: opts.checks,
      clock: opts.clock,
      gates: this.gates,
      quotaWaits: this.quotaWaits,
      row: (id) => this.row(id),
      stepRow: (runId, stepId, attempt) => this.stepRow(runId, stepId, attempt),
      setStatus: (runId, status, why) => this.setStatus(runId, status, why),
      end: (runId, status, why) => this.end(runId, status, why),
      setReasonKey: (runId, key, params) => this.setReasonKey(runId, key, params),
      emit: (runId) => this.emit(runId),
      active: (runId) => this.active(runId),
      trusted: (projectId, name, hash) => this.trusted(projectId, name, hash),
      recordHead: (runId, worktree) => this.recordHead(runId, worktree),
    });
  }

  async list(project: Project): Promise<WorkflowInfo[]> {
    const sources = await workflowSources(project.path, refArg(project.baseBranch));
    return sources.map((source) => this.info(project.id, source));
  }

  /** Trusts the workflow's current content; `hash` is what the user reviewed. */
  async trust(project: Project, name: string, hash: string): Promise<WorkflowInfo> {
    const source = await this.source(project, name);
    if (source.hash !== hash) {
      throw new FlightdeckError(
        "invalid_state",
        `workflow ${name} changed; review the commands again before trusting it`,
        "workflow_changed_review",
        { name },
      );
    }
    const { issues } = parseWorkflow(source.source);
    if (issues.length > 0) {
      throw new FlightdeckError(
        "invalid_state",
        `workflow ${name} has validation errors`,
        "workflow_invalid",
        { name },
        issues,
      );
    }
    this.db
      .query(
        "INSERT OR IGNORE INTO trusted_workflows (project_id, name, hash, trusted_at) VALUES (?, ?, ?, ?)",
      )
      .run(project.id, name, hash, now());
    return this.info(project.id, source);
  }

  /**
   * Creates the run of a card about to start (same id as the card's run). Refuses a workflow
   * that is not on the base branch, has validation errors or whose content is not trusted, and
   * inputs missing or not declared.
   */
  async prepare(
    cardId: string,
    runId: string,
    project: Project,
    name: string,
    inputs: Record<string, string>,
  ): Promise<void> {
    const source = await this.source(project, name);
    const { workflow, errors, issues } = parseWorkflow(source.source);
    if (!workflow) {
      throw new FlightdeckError(
        "invalid_state",
        `workflow ${name} has validation errors: ${errors.join("; ")}`,
        "workflow_invalid",
        { name },
        issues,
      );
    }
    if (!this.trusted(project.id, name, source.hash)) {
      throw new FlightdeckError(
        "invalid_state",
        `workflow ${name} is not trusted; trust it on the workflows screen`,
        "workflow_not_trusted",
        { name },
      );
    }
    const missing = workflow.inputs.find((input) => !inputs[input]?.trim());
    if (missing)
      throw new FlightdeckError(
        "invalid_state",
        `required input: ${missing}`,
        "workflow_input_required",
        { input: missing },
      );
    const unknown = Object.keys(inputs).find((input) => !workflow.inputs.includes(input));
    if (unknown)
      throw new FlightdeckError(
        "invalid_state",
        `unknown input: ${unknown}`,
        "workflow_input_unknown",
        { input: unknown },
      );
    this.db
      .query(
        `INSERT INTO workflow_runs (id, card_id, workflow_name, workflow_hash, definition, status,
         budget, usage, inputs, started_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
      )
      .run(
        runId,
        cardId,
        name,
        source.hash,
        source.source,
        JSON.stringify(workflow.budget),
        JSON.stringify(noSpending()),
        JSON.stringify(inputs),
        now(),
      );
    this.emit(runId);
  }

  /** Whether `runId` (a card run) is a workflow run. */
  has(runId: string): boolean {
    return this.db.query("SELECT 1 FROM workflow_runs WHERE id = ?").get(runId) !== null;
  }

  /** The card's worktree is ready and its slot taken: the run executes its steps. */
  begin(runId: string, worktree: string): void {
    this.setStatus(runId, "running", null);
    void this.steps.execute(runId, worktree);
  }

  /**
   * Back from a restart: runs that were going on continue from where they stopped. Steps already
   * finished keep their stored results; see `runStep`.
   */
  recover(): void {
    const runs = this.db
      .query<RunRow, []>("SELECT * FROM workflow_runs WHERE status IN ('running', 'waiting')")
      .all();
    for (const run of runs) {
      // A run whose card is gone fails alone: it never stops the daemon's start.
      const card = this.cardOrNull(run.card_id);
      if (!card?.worktreePath) {
        this.end(run.id, "failed", "the run's card is gone");
        this.setReasonKey(run.id, "run_card_gone", {});
        continue;
      }
      // At a gate the run holds no slot; it takes one again once the gate is approved.
      if (run.status === "running") this.host.hold(run.card_id);
      void this.steps.execute(run.id, card.worktreePath);
    }
    // #1266: a resume that was waiting for its slot waits again, with the HEAD it was given.
    const resumed = this.db
      .query<RunRow & { head: string | null }, []>(
        `SELECT r.*, (SELECT head FROM run_resumes WHERE run_id = r.id ORDER BY n DESC LIMIT 1) AS head
         FROM workflow_runs r WHERE r.status = 'queued'
         AND EXISTS (SELECT 1 FROM run_resumes WHERE run_id = r.id)`,
      )
      .all();
    for (const run of resumed) {
      // What a resume would refuse is never run: its card must still be the run's, its stored
      // definition its hash, the workflow still trusted, and a HEAD recorded. Any of these
      // failing fails that run only, never the daemon's start.
      const card = this.cardOrNull(run.card_id);
      const why = (() => {
        if (!card?.worktreePath || card.discarded || card.workflowRunId !== run.id) {
          return "run_resume_card";
        }
        if (hashOf(run.definition) !== run.workflow_hash) return "run_resume_workflow_changed";
        if (!this.trusted(card.projectId, run.workflow_name, run.workflow_hash)) {
          return "workflow_not_trusted";
        }
        return run.head ? null : "run_resume_no_head";
      })();
      if (why || !card?.worktreePath || !run.head) {
        // The HEAD stays: asked again, the run gives the same reason, not that it has none.
        this.restoreHead(run.id, run.head);
        this.end(run.id, "failed", "the resume cannot go on after the restart");
        const key = why ?? "run_resume_card";
        this.setReasonKey(
          run.id,
          key,
          key === "run_resume_workflow_changed" || key === "workflow_not_trusted"
            ? { name: run.workflow_name }
            : {},
        );
        // Only a card that is still this run's goes to waiting: one that moved on to another
        // run stays where that run put it.
        if (card?.workflowRunId === run.id) {
          this.host.place(run.card_id, { type: "workflow", state: "waiting" });
        }
        continue;
      }
      this.resuming.add(run.id);
      void this.afterSlot(run.id, run.card_id, card.worktreePath, run.head);
    }
  }

  private cardOrNull(cardId: string): Card | null {
    try {
      return this.host.card(cardId);
    } catch {
      return null;
    }
  }

  /** Nothing reached an agent (worktree or setup failed); the board moves the card itself. */
  fail(
    runId: string,
    why: string,
    refusal: { reason: string; params?: Record<string, string | number> } | null = null,
  ): void {
    this.end(runId, "failed", why);
    if (refusal) this.setReasonKey(runId, refusal.reason, refusal.params ?? {});
  }

  /** The reason a run ended, as a key and params the app translates. */
  private setReasonKey(runId: string, key: string, params: Record<string, string | number>): void {
    this.db
      .query(
        "UPDATE workflow_runs SET status_reason_key = ?, status_reason_params = ? WHERE id = ?",
      )
      .run(key, JSON.stringify(params), runId);
    this.emit(runId);
  }

  /**
   * The board ended the card's run (stopped in the queue, completed, discarded): its workflow
   * runs still going end too, except `keep` (the one launching). Open steps (a gate included)
   * close as failed, and a running run gives its slot back.
   */
  abandon(cardId: string, why: string, keep = ""): void {
    const runs = this.db
      .query<RunRow, [string, string]>(
        "SELECT * FROM workflow_runs WHERE card_id = ? AND id <> ? AND status IN ('queued', 'running', 'waiting')",
      )
      .all(cardId, keep);
    for (const run of runs) {
      this.db
        .query(
          "UPDATE step_runs SET status = 'failed', ended_at = ? WHERE run_id = ? AND ended_at IS NULL",
        )
        .run(now(), run.id);
      for (const key of [...this.gates.keys()]) // NOSONAR: the loop deletes from the map it walks; the copy keeps the walk stable
        if (key.startsWith(`${run.id}/`)) this.gates.delete(key);
      this.quotaWaits.delete(run.id);
      this.end(run.id, "failed", why);
      if (run.status === "running") this.host.release(cardId);
    }
  }

  // -- resume (#1266) ---------------------------------------------------------

  private async recordHead(runId: string, worktree: string): Promise<void> {
    const head = await this.headOf(worktree).catch(() => null);
    this.db.query("UPDATE workflow_runs SET head_at_end = ? WHERE id = ?").run(head, runId);
  }

  /**
   * Whether a failed run can resume, and from which step: the first one not completed. Refused
   * when it did not fail, its card cannot take it, it has no recorded HEAD, the workflow on the
   * base branch changed or is no longer trusted, or the card's branch moved since it ended.
   */
  async resumeCheck(runId: string, project: Project): Promise<RunResumeCheck> {
    const run = this.row(runId);
    const workflow = parseWorkflow(run.definition).workflow as Workflow;
    const from =
      workflow.steps.find((step) => this.stepRow(run.id, step.id, 1)?.status !== "completed")?.id ??
      "";
    const no = (reason: string, params?: Record<string, string>): RunResumeCheck => ({
      from,
      ok: false,
      reason,
      ...(params ? { params } : {}),
    });
    if (run.status !== "failed" || this.resuming.has(run.id)) return no("run_resume_not_failed");
    // What runs is the stored definition: it must still be the one its hash names.
    if (hashOf(run.definition) !== run.workflow_hash) {
      return no("run_resume_workflow_changed", { name: run.workflow_name });
    }
    let card: Card;
    try {
      card = this.host.card(run.card_id);
    } catch {
      return no("run_resume_card");
    }
    if (card.discarded || !card.worktreePath || card.workflowRunId !== run.id) {
      return no("run_resume_card");
    }
    if (!run.head_at_end) return no("run_resume_no_head");
    const source = await this.source(project, run.workflow_name).catch(() => null);
    if (source?.hash !== run.workflow_hash) {
      return no("run_resume_workflow_changed", { name: run.workflow_name });
    }
    if (!this.trusted(project.id, run.workflow_name, source.hash)) {
      return no("workflow_not_trusted", { name: run.workflow_name });
    }
    if ((await this.headOf(card.worktreePath).catch(() => null)) !== run.head_at_end) {
      return no("run_resume_branch_moved");
    }
    return { from, ok: true };
  }

  /**
   * Resumes a failed run in place: the check again, the resume recorded with what failed, the
   * steps not completed cleared (the failed one runs from scratch), then the run waits for a slot
   * and executes; the completed steps give back what they stored.
   */
  async resume(runId: string, project: Project): Promise<RunResumeCheck> {
    const check = await this.resumeCheck(runId, project);
    if (!check.ok) {
      throw new FlightdeckError(
        "invalid_state",
        `run ${runId} cannot resume: ${check.reason}`,
        check.reason,
        check.params,
      );
    }
    // Nothing awaited from here to the writes: the run and its card are checked again as they are
    // now, so a second resume or a start that came in meanwhile cannot run beside this one.
    const run = this.row(runId);
    const card = this.host.card(run.card_id);
    if (run.status !== "failed" || this.resuming.has(run.id)) {
      throw new FlightdeckError(
        "invalid_state",
        `run ${runId} is no longer failed`,
        "run_resume_not_failed",
      );
    }
    if (card.discarded || card.queued || !card.worktreePath || card.workflowRunId !== run.id) {
      throw new FlightdeckError(
        "invalid_state",
        "the run's card cannot take it",
        "run_resume_card",
      );
    }
    const worktree = card.worktreePath;
    const head = run.head_at_end;
    this.resuming.add(run.id);
    try {
      this.write(run, check.from, head);
    } catch (error) {
      // Nothing was written: the run stays failed, and resumable.
      this.resuming.delete(run.id);
      throw error;
    }
    this.emit(run.id);
    void this.afterSlot(run.id, run.card_id, worktree, head);
    return check;
  }

  /** The resume recorded, the failed step's rows gone and the run's end cleared, all or none. */
  private write(run: RunRow, from: string, head: string | null): void {
    const check = { from };
    this.db.transaction(() => {
      const { n } = this.db
        .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM run_resumes WHERE run_id = ?")
        .get(run.id) ?? { n: 0 };
      this.db
        .query(
          "INSERT INTO run_resumes (run_id, n, from_step, reason, head, at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(run.id, n + 1, check.from, run.status_reason, head, now());
      // The failed step runs from scratch, with its own items and attempts: the rows the engine
      // names after it (`<id>.<n>` of a parallel, `<id>.check` and `<id>.do` of a loop), taken from
      // its definition, so a step whose id only looks like one of them keeps its result.
      const own = childrenOf(run.definition, from);
      const stale = this.db
        .query<{ step_id: string; attempt: number; status: string }, [string]>(
          "SELECT step_id, attempt, status FROM step_runs WHERE run_id = ?",
        )
        .all(run.id)
        .filter(
          (row) => row.status !== "completed" || row.step_id === check.from || own.has(row.step_id),
        );
      for (const row of stale) {
        this.db
          .query("DELETE FROM step_runs WHERE run_id = ? AND step_id = ? AND attempt = ?")
          .run(run.id, row.step_id, row.attempt);
      }
      this.db
        .query(
          `UPDATE workflow_runs SET ended_at = NULL, head_at_end = NULL, status_reason_key = NULL,
           status_reason_params = NULL, status = 'queued', status_reason = NULL WHERE id = ?`,
        )
        .run(run.id);
    })();
  }

  /**
   * The resumed run got its slot: unless something ended it while it waited, and with the branch
   * still where it was (it may have moved during the wait), it executes; else the slot goes back.
   */
  private async afterSlot(
    runId: string,
    cardId: string,
    worktree: string,
    head: string | null,
  ): Promise<void> {
    let held = false;
    try {
      await this.host.acquire(cardId);
      held = true;
      if (this.row(runId).status !== "queued") {
        this.host.release(cardId);
        return;
      }
      if (head === null || (await this.headOf(worktree).catch(() => null)) !== head) {
        // The HEAD stays: asked again, the run says the branch moved, not that it has none.
        this.restoreHead(runId, head);
        this.end(runId, "failed", "the card's branch moved while the run waited");
        this.setReasonKey(runId, "run_resume_branch_moved", {});
        this.host.place(cardId, { type: "workflow", state: "waiting" });
        this.host.release(cardId);
        return;
      }
      this.host.place(cardId, { type: "workflow", state: "running" });
      this.begin(runId, worktree);
      // From here the run owns the slot: its own end gives it back, not this catch.
      held = false;
    } catch (error) {
      // The run may be gone (its card discarded meanwhile): its slot still goes back.
      if (held) this.host.release(cardId);
      try {
        this.restoreHead(runId, head);
        this.end(runId, "failed", reason(error));
        this.host.place(cardId, { type: "workflow", state: "waiting" });
      } catch {
        // Nothing left to end.
      }
    } finally {
      this.resuming.delete(runId);
    }
  }

  private restoreHead(runId: string, head: string | null): void {
    this.db.query("UPDATE workflow_runs SET head_at_end = ? WHERE id = ?").run(head, runId);
  }

  /** "Parar": interrupts the turns going on; the interrupted step fails the run. */
  async interrupt(runId: string): Promise<void> {
    const sessions = this.db
      .query<{ session_id: string }, [string]>(
        "SELECT DISTINCT session_id FROM step_runs WHERE run_id = ? AND status = 'running' AND session_id IS NOT NULL",
      )
      .all(runId);
    await inSequence(sessions, async ({ session_id }) => {
      await this.manager.interrupt(session_id);
    });
  }

  /** Closes the sessions of the card's runs, except those of `keep` (the run launching). */
  async closeSessions(cardId: string, keep = ""): Promise<void> {
    const sessions = this.db
      .query<{ session_id: string }, [string, string]>(
        `SELECT DISTINCT s.session_id FROM step_runs s JOIN workflow_runs r ON r.id = s.run_id
         WHERE r.card_id = ? AND r.id <> ? AND s.session_id IS NOT NULL`,
      )
      .all(cardId, keep);
    await inSequence(sessions, async ({ session_id }) => {
      await this.manager.close(session_id);
    });
  }

  /** Answers an open gate: approved, the run goes on; rejected, it ends as `rejected`. */
  respond(
    runId: string,
    stepId: string,
    attempt: number,
    decision: "approve" | "reject",
    note?: string,
  ): void {
    this.row(runId);
    const step = this.stepRow(runId, stepId, attempt);
    if (step?.type !== "gate" || step.status !== "waiting") {
      throw new FlightdeckError(
        "invalid_state",
        `gate ${stepId} (attempt ${attempt}) is not open`,
        "workflow_gate_closed",
        { step: stepId, attempt },
      );
    }
    const status = decision === "approve" ? "approved" : "rejected";
    this.db
      .query(
        "UPDATE step_runs SET status = ?, note = ?, ended_at = ? WHERE run_id = ? AND step_id = ? AND attempt = ?",
      )
      .run(status, note ?? null, now(), runId, stepId, attempt);
    this.emit(runId);
    const key = `${runId}/${stepId}/${attempt}`;
    this.gates.get(key)?.();
    this.gates.delete(key);
  }

  /** Gets every run after each change; returns the function that stops it. */
  watch(listener: (run: WorkflowRun) => void): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  /** Runs still going, for a watcher that just arrived. */
  activeRuns(): WorkflowRun[] {
    return this.db
      .query<{ id: string }, []>(
        "SELECT id FROM workflow_runs WHERE status IN ('queued', 'running', 'waiting') ORDER BY started_at",
      )
      .all()
      .map(({ id }) => this.getRun(id));
  }

  /** The workflow as it is on the base branch, with its validation. */
  async validate(project: Project, name: string): Promise<WorkflowInfo> {
    return this.info(project.id, await this.source(project, name));
  }

  /** Whether the run is still going (queued, running or at a gate). */
  active(runId: string): boolean {
    return ACTIVE.has(this.row(runId).status);
  }

  /** A discarded card takes its runs along. */
  forget(cardId: string): void {
    this.db
      .query(
        "DELETE FROM step_runs WHERE run_id IN (SELECT id FROM workflow_runs WHERE card_id = ?)",
      )
      .run(cardId);
    this.db.query("DELETE FROM workflow_runs WHERE card_id = ?").run(cardId);
  }

  getRun(id: string): WorkflowRun {
    const row = this.row(id);
    const steps = this.db
      .query<StepRow, [string]>("SELECT * FROM step_runs WHERE run_id = ? ORDER BY rowid")
      .all(id)
      .map(toStep);
    const quotaUntil = this.quotaWaits.get(id);
    return {
      id: row.id,
      cardId: row.card_id,
      workflowName: row.workflow_name,
      workflowHash: row.workflow_hash,
      status: row.status,
      statusReason: row.status_reason,
      reasonKey: row.status_reason_key,
      ...col.shownOf(row),
      startedAt: row.started_at,
      endedAt: row.ended_at,
      steps,
      quotaUntil: quotaUntil ? new Date(quotaUntil).toISOString() : null,
    };
  }

  // -- state ----------------------------------------------------------------

  private row(id: string): RunRow {
    const row = this.db.query<RunRow, [string]>("SELECT * FROM workflow_runs WHERE id = ?").get(id);
    if (!row)
      throw new FlightdeckError("not_found", `run ${id} does not exist`, "workflow_run_not_found", {
        id,
      });
    return row;
  }

  private stepRow(runId: string, stepId: string, attempt: number): StepRow | null {
    return this.db
      .query<StepRow, [string, string, number]>(
        "SELECT * FROM step_runs WHERE run_id = ? AND step_id = ? AND attempt = ?",
      )
      .get(runId, stepId, attempt);
  }

  private setStatus(runId: string, status: RunStatus, why: string | null): void {
    this.db
      .query("UPDATE workflow_runs SET status = ?, status_reason = ? WHERE id = ?")
      .run(status, why, runId);
    this.emit(runId);
  }

  private end(runId: string, status: RunStatus, why: string | null): void {
    this.db.query("UPDATE workflow_runs SET ended_at = ? WHERE id = ?").run(now(), runId);
    this.setStatus(runId, status, why);
  }

  /** Sends the run as it is now to every watcher. */
  private emit(runId: string): void {
    if (this.watchers.size === 0) return;
    const run = this.getRun(runId);
    for (const watcher of this.watchers) {
      try {
        watcher(run);
      } catch {
        // A broken watcher must not break the run.
      }
    }
  }

  // -- catalog --------------------------------------------------------------

  private async source(project: Project, name: string): Promise<WorkflowSource> {
    const sources = await workflowSources(project.path, refArg(project.baseBranch));
    const source = sources.find((s) => s.name === name);
    if (!source) {
      throw new FlightdeckError(
        "not_found",
        `workflow ${name} does not exist on the branch ${project.baseBranch}`,
        "workflow_not_on_branch",
        { name, branch: project.baseBranch },
      );
    }
    return source;
  }

  private trusted(projectId: string, name: string, hash: string): boolean {
    return (
      this.db
        .query("SELECT 1 FROM trusted_workflows WHERE project_id = ? AND name = ? AND hash = ?")
        .get(projectId, name, hash) !== null
    );
  }

  private info(projectId: string, source: WorkflowSource): WorkflowInfo {
    const { workflow, errors, issues } = parseWorkflow(source.source);
    return {
      name: source.name,
      hash: source.hash,
      trusted: this.trusted(projectId, source.name, source.hash),
      checks: workflow ? checkCommands(workflow) : [],
      errors,
      issues,
      inputs: workflow?.inputs ?? [],
    };
  }
}
