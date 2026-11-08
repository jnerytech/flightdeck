import type { Database } from "bun:sqlite";
import type {
  PermissionMode,
  RunResumeCheck,
  RunStatus,
  SessionEvent,
  SessionStatus,
  StepRun,
  StepStatus,
  StepType,
  WorkflowInfo,
  WorkflowRun,
} from "@flightdeck/protocol";
import { inSequence } from "@flightdeck/protocol";
import type { BoardEvent } from "../board/columns.ts";
import { git } from "../board/command.ts";
import { refArg } from "../board/ref-arg.ts";
import type { Card, Project } from "../board/types.ts";
import { FlightdeckError } from "../errors.ts";
import { type Prepare, withoutPersonas } from "../personas/prepare.ts";
import type { SessionManager } from "../sessions/session-manager.ts";
import { addTurn, noSpending, overBudget, type RunSpending } from "./budget.ts";
import type { CheckResult, CheckRunner } from "./check-runner.ts";
import { CARDS_PER_RUN, type CardsRaised, type Finding, parseFindings } from "./findings.ts";
import { type InterpolationContext, interpolate, OUTPUTS_SEPARATOR } from "./interpolate.ts";
import { hashOf, type WorkflowSource, workflowSources } from "./repo.ts";
import {
  type Action,
  type AgentAction,
  checkCommands,
  type InnerAction,
  parseWorkflow,
  type Step,
  type Workflow,
} from "./schema.ts";

/** What the engine needs from the board that owns the cards. */
export interface EngineHost {
  place(cardId: string, event: BoardEvent): void;
  /** The run stopped holding the card's slot in the host queue. */
  release(cardId: string): void;
  /** Back from a restart: the card's run holds its slot again, without waiting. */
  hold(cardId: string): void;
  /** Over the plan quota: when it frees (`until` in ms, if known); `null` when a turn may go. */
  waitQuota(): { until: number | null; done: Promise<void> } | null;
  /** Takes a slot for the card again, waiting in the host queue (ahead of queued cards). */
  acquire(cardId: string): Promise<void>;
  /** Up to `count` free slots of the host right now, without waiting; `release` gives each back. */
  takeSlots(cardId: string, count: number): string[];
  /** Pushes the card's branch and opens its PR (phase 4); the PR's URL. */
  createPr(cardId: string): Promise<string>;
  /** Issue #79: raises findings as Backlog cards of the card's project. */
  raiseCards(
    cardId: string,
    findings: readonly Finding[],
    origin: { workflow: string; runId: string },
  ): CardsRaised;
  card(cardId: string): Card;
}

export interface WorkflowEngineOptions {
  db: Database;
  manager: SessionManager;
  /** Reads the personas for a session about to open; none when absent. */
  preparePersonas?: Prepare;
  host: EngineHost;
  checks: CheckRunner;
  /** Milliseconds now: the budget's minutes. */
  clock: () => number;
  /** #1266: the commit a worktree is at; null when git cannot say. The real git when absent. */
  headOf?: (worktree: string) => Promise<string | null>;
}

/** The commit a worktree's HEAD is at, from git; null when it cannot say. */
async function gitHead(worktree: string): Promise<string | null> {
  const found = await git(worktree, "rev-parse", "--verify", "--quiet", "HEAD");
  return found.code === 0 ? found.stdout.trim() : null;
}

interface RunRow {
  id: string;
  card_id: string;
  workflow_name: string;
  workflow_hash: string;
  definition: string;
  status: RunStatus;
  status_reason: string | null;
  status_reason_key: string | null;
  status_reason_params: string | null;
  budget: string;
  usage: string;
  inputs: string;
  started_at: string;
  ended_at: string | null;
  /** #1266: the worktree's HEAD when the run failed; null before the column, or with no step run. */
  head_at_end: string | null;
}

interface StepRow {
  run_id: string;
  step_id: string;
  attempt: number;
  type: StepType;
  status: StepStatus;
  session_id: string | null;
  output: string | null;
  exit_code: number | null;
  note: string | null;
  message: string | null;
  usage: string | null;
  started_at: string;
  ended_at: string | null;
}

const toStep = (row: StepRow): StepRun => ({
  stepId: row.step_id,
  attempt: row.attempt,
  type: row.type,
  status: row.status,
  sessionId: row.session_id,
  output: row.output,
  exitCode: row.exit_code,
  note: row.note,
  message: row.message,
  usage: row.usage ? JSON.parse(row.usage) : null,
  startedAt: row.started_at,
  endedAt: row.ended_at,
});

const now = () => new Date().toISOString();

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The run was ended by the board while it waited: nothing more to do. */
class Abandoned extends Error {}

/** Fails the run with a reason the app translates (`status_reason_key` and its params). */
class Refused extends Error {
  constructor(
    readonly reasonKey: string,
    readonly params: Record<string, string>,
    why: string,
  ) {
    super(why);
  }
}

/** Ends the run with a status of its own (not `failed`), such as a rejected gate. */
class Stop extends Error {
  constructor(
    readonly status: RunStatus,
    why: string,
  ) {
    super(why);
  }
}

const ACTIVE: ReadonlySet<RunStatus> = new Set(["queued", "running", "waiting"]);

const STOPPED: ReadonlySet<SessionStatus> = new Set(["error", "ended"]);

/** Before the prompt of an agent step whose turn a restart cut short. */
export const RESUMED_NOTE = "A execução foi interrompida; continue de onde parou.";

/** Workflows of the projects: catalog read from the base branch, trust and runs. */
export class WorkflowEngine {
  private readonly db: Database;
  private readonly manager: SessionManager;
  private readonly preparePersonas: Prepare;
  private readonly host: EngineHost;
  private readonly checks: CheckRunner;
  private readonly clock: () => number;
  private readonly headOf: (worktree: string) => Promise<string | null>;
  /** #1266: the runs being resumed right now: a second resume of one is refused. */
  private readonly resuming = new Set<string>();
  /** Open gates of this process, by `run/step/attempt`: wakes the run when answered. */
  private readonly gates = new Map<string, () => void>();
  private readonly watchers = new Set<(run: WorkflowRun) => void>();
  /** Runs waiting for the plan quota before an agent turn: until when (ms), if known. */
  private readonly quotaWaits = new Map<string, number | null>();

  constructor(opts: WorkflowEngineOptions) {
    this.db = opts.db;
    this.manager = opts.manager;
    this.preparePersonas = opts.preparePersonas ?? withoutPersonas;
    this.host = opts.host;
    this.checks = opts.checks;
    this.clock = opts.clock;
    this.headOf = opts.headOf ?? gitHead;
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
    void this.execute(runId, worktree);
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
      const { worktreePath } = this.host.card(run.card_id);
      // At a gate the run holds no slot; it takes one again once the gate is approved.
      if (run.status === "running") this.host.hold(run.card_id);
      void this.execute(run.id, worktreePath as string);
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
      // A card gone, with no worktree, or a resume with no HEAD fails that run only, never the
      // daemon's start: what a resume would refuse is never run.
      let worktree: string | null = null;
      try {
        worktree = this.host.card(run.card_id).worktreePath;
      } catch {
        worktree = null;
      }
      if (!worktree || !run.head) {
        this.end(run.id, "failed", "the resume cannot go on after the restart");
        this.setReasonKey(run.id, worktree ? "run_resume_no_head" : "run_resume_card", {});
        continue;
      }
      this.resuming.add(run.id);
      void this.afterSlot(run.id, run.card_id, worktree, run.head);
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
    this.setStatus(run.id, "queued", null);
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
      // The failed step runs from scratch, its parallel items (`<id>.<n>`) and attempts with it.
      const stale = this.db
        .query<{ step_id: string; attempt: number; status: string }, [string]>(
          "SELECT step_id, attempt, status FROM step_runs WHERE run_id = ?",
        )
        .all(run.id)
        .filter(
          (row) =>
            row.status !== "completed" ||
            row.step_id === check.from ||
            row.step_id.startsWith(`${check.from}.`),
        );
      for (const row of stale) {
        this.db
          .query("DELETE FROM step_runs WHERE run_id = ? AND step_id = ? AND attempt = ?")
          .run(run.id, row.step_id, row.attempt);
      }
      this.db
        .query(
          `UPDATE workflow_runs SET ended_at = NULL, head_at_end = NULL, status_reason_key = NULL,
           status_reason_params = NULL WHERE id = ?`,
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
      // From here the run owns the slot: its own end gives it back, not this catch.
      held = false;
      this.begin(runId, worktree);
    } catch (error) {
      // The run may be gone (its card discarded meanwhile): its slot still goes back.
      if (held) this.host.release(cardId);
      try {
        this.restoreHead(runId, head);
        this.end(runId, "failed", reason(error));
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
    const { turns, minutes, costUsd } = JSON.parse(row.usage) as RunSpending;
    const quotaUntil = this.quotaWaits.get(id);
    return {
      id: row.id,
      cardId: row.card_id,
      workflowName: row.workflow_name,
      workflowHash: row.workflow_hash,
      status: row.status,
      statusReason: row.status_reason,
      reasonKey: row.status_reason_key,
      reasonParams: row.status_reason_params ? JSON.parse(row.status_reason_params) : null,
      budget: JSON.parse(row.budget),
      usage: { turns, minutes, costUsd },
      inputs: JSON.parse(row.inputs),
      startedAt: row.started_at,
      endedAt: row.ended_at,
      steps,
      quotaUntil: quotaUntil ? new Date(quotaUntil).toISOString() : null,
    };
  }

  // -- execution ------------------------------------------------------------

  private async execute(runId: string, worktree: string): Promise<void> {
    const run = this.row(runId);
    // Validated when the run was prepared.
    const workflow = parseWorkflow(run.definition).workflow as Workflow;
    const context: InterpolationContext = { inputs: JSON.parse(run.inputs), steps: {} };
    try {
      await inSequence(workflow.steps, async (step) => {
        context.steps[step.id] = await this.runStep(run, worktree, step, context);
      });
      this.finish(run, "completed", null);
    } catch (error) {
      if (error instanceof Abandoned) return;
      // #1266: where the code was when it failed; a resume needs the branch still there.
      if (!(error instanceof Stop)) await this.recordHead(run.id, worktree);
      if (error instanceof Stop) this.finish(run, error.status, error.message);
      else if (error instanceof Refused) {
        this.finish(run, "failed", error.message);
        this.setReasonKey(run.id, error.reasonKey, error.params);
      } else this.finish(run, "failed", reason(error));
    }
  }

  private async runStep(
    run: RunRow,
    worktree: string,
    step: Step,
    context: InterpolationContext,
  ): Promise<{ output?: string; outputs?: string[] }> {
    // Replayed after a restart: a finished step gives back what it stored.
    const finished = this.stepRow(run.id, step.id, 1);
    if (finished?.status === "completed") {
      if (!("parallel" in step)) return { output: finished.output ?? "" };
      const items = step.parallel.map((_, i) => this.stepRow(run.id, `${step.id}.${i}`, 1));
      return { outputs: items.map((item) => item?.output ?? "") };
    }
    if ("gate" in step) return { output: await this.gateStep(run, step.id, step.gate, context) };
    if ("loop" in step) {
      return { output: await this.loopStep(run, worktree, step.id, step.loop, context) };
    }
    if ("pr" in step) return { output: await this.prStep(run, step.id) };
    if ("cards" in step) return { output: this.cardsStep(run, step.id, step.cards.from, context) };
    if ("parallel" in step) {
      return { outputs: await this.parallelStep(run, worktree, step.id, step.parallel, context) };
    }
    const action = step as InnerAction;
    return { output: await this.innerStep(run, worktree, step.id, 1, action, context) };
  }

  /**
   * Runs the items (`<id>.<index>`) with the card's slot plus the host slots free right now, so
   * `maxParallelRuns` holds; with none free they go one after another. Outputs keep the declared
   * order; a failed item fails the step once every item has finished.
   */
  private async parallelStep(
    run: RunRow,
    worktree: string,
    stepId: string,
    items: InnerAction[],
    context: InterpolationContext,
  ): Promise<string[]> {
    this.db
      .query(
        `INSERT OR IGNORE INTO step_runs (run_id, step_id, attempt, type, status, started_at)
         VALUES (?, ?, 1, 'parallel', 'running', ?)`,
      )
      .run(run.id, stepId, now());
    this.emit(run.id);
    const extra = this.host.takeSlots(run.card_id, items.length - 1);
    const outputs: string[] = [];
    /** By item index: the first declared failure is the one reported. */
    const failures: Array<{ error: unknown }> = [];
    let next = 0;
    const worker = async () => {
      for (let index = next++; index < items.length; index = next++) {
        const item = items[index] as InnerAction;
        try {
          outputs[index] =
            await /* NOSONAR: a worker of the pool takes the next item only when its previous one is done */ this.innerStep(
              run,
              worktree,
              `${stepId}.${index}`,
              1,
              item,
              context,
            );
        } catch (error) {
          failures[index] = { error };
        }
      }
    };
    await Promise.all([worker(), ...extra.map(() => worker())]);
    for (const key of extra) this.host.release(key);
    const failed = failures.find((failure) => failure !== undefined);
    if (failed) {
      this.endStep(run.id, stepId, 1, "failed", null);
      throw failed.error;
    }
    this.endStep(run.id, stepId, 1, "completed", outputs.join(OUTPUTS_SEPARATOR));
    return outputs;
  }

  /** Push and PR through the project's provider; the card goes to Em revisão. */
  private async prStep(run: RunRow, stepId: string): Promise<string> {
    this.db
      .query(
        `INSERT OR IGNORE INTO step_runs (run_id, step_id, attempt, type, status, started_at)
         VALUES (?, ?, 1, 'pr', 'running', ?)`,
      )
      .run(run.id, stepId, now());
    this.emit(run.id);
    try {
      const url = await this.host.createPr(run.card_id);
      this.endStep(run.id, stepId, 1, "completed", url);
      return url;
    } catch (error) {
      this.endStep(run.id, stepId, 1, "failed", null);
      throw new Error(`etapa ${stepId} falhou: ${reason(error)}`);
    }
  }

  /** Issue #79: raises the findings in the reply of an earlier agent step as Backlog cards. */
  private cardsStep(
    run: RunRow,
    stepId: string,
    from: string,
    context: InterpolationContext,
  ): string {
    this.db
      .query(
        `INSERT OR IGNORE INTO step_runs (run_id, step_id, attempt, type, status, started_at)
         VALUES (?, ?, 1, 'cards', 'running', ?)`,
      )
      .run(run.id, stepId, now());
    this.emit(run.id);
    // The reply is untrusted text: any shape problem raises nothing and the run says why.
    const parsed = parseFindings(context.steps[from]?.output ?? "");
    if (!parsed.ok) {
      this.endStep(run.id, stepId, 1, "failed", null);
      const params: Record<string, string> = { step: from };
      if (parsed.reason === "findings_invalid") params.where = parsed.where;
      throw new Refused(
        parsed.reason,
        params,
        parsed.reason === "findings_missing"
          ? `step ${stepId}: the reply of ${from} has no json block of findings`
          : `step ${stepId}: the reply of ${from} is not a valid list of findings (${params.where})`,
      );
    }
    const raised = this.host.raiseCards(run.card_id, parsed.findings, {
      workflow: run.workflow_name,
      runId: run.id,
    });
    const count = raised.created.length;
    const summary = `Raised ${count} ${count === 1 ? "card" : "cards"}; ${raised.duplicates} already covered; ${raised.overCap} over the cap of ${CARDS_PER_RUN}.`;
    this.endStep(run.id, stepId, 1, "completed", summary);
    return summary;
  }

  /** An agent or a check (on its own, or inside a loop or a parallel); a failed check fails. */
  private async innerStep(
    run: RunRow,
    worktree: string,
    stepId: string,
    attempt: number,
    action: InnerAction,
    context: InterpolationContext,
  ): Promise<string> {
    if ("check" in action) {
      const { exitCode, output } = await this.checkStep(
        run,
        worktree,
        stepId,
        attempt,
        action.check,
      );
      if (exitCode !== 0)
        throw new Error(`etapa ${stepId} falhou: check saiu com código ${exitCode}`);
      return output;
    }
    return this.agentStep(run, worktree, stepId, attempt, action.agent, context);
  }

  /**
   * Checks `until`; while it fails, runs `do` (iteration n is attempt n of `<id>.check` and
   * `<id>.do`) with the last check in `{{loop.lastCheck.*}}`. After `max` runs of `do` with the
   * check still failing, the run pauses. The loop's output is the passing check's.
   */
  private async loopStep(
    run: RunRow,
    worktree: string,
    stepId: string,
    loop: Extract<Action, { loop: unknown }>["loop"],
    context: InterpolationContext,
  ): Promise<string> {
    this.db
      .query(
        `INSERT OR IGNORE INTO step_runs (run_id, step_id, attempt, type, status, started_at)
         VALUES (?, ?, 1, 'loop', 'running', ?)`,
      )
      .run(run.id, stepId, now());
    this.emit(run.id);
    try {
      for (let attempt = 1; ; attempt++) {
        const check =
          await /* NOSONAR: retry: an attempt starts only after the one before has not worked */ this.checkStep(
            run,
            worktree,
            `${stepId}.check`,
            attempt,
            loop.until.check,
          );
        if (check.exitCode === 0) {
          this.endStep(run.id, stepId, 1, "completed", check.output);
          return check.output;
        }
        if (attempt > loop.max) {
          const why = `loop ${stepId}: o check ainda falha depois de ${loop.max} repetições`;
          throw new Stop("paused", why);
        }
        const inner = { ...context, loop: { lastCheck: check } };
        await this.innerStep(run, worktree, `${stepId}.do`, attempt, loop.do, inner); // NOSONAR: a worker of the pool takes the next item only when its previous one is done
      }
    } catch (error) {
      this.endStep(run.id, stepId, 1, "failed", null);
      throw error;
    }
  }

  /**
   * Waits for your answer: the card goes to Esperando você and its slot is freed meanwhile.
   * Approved, the run takes a slot again and goes on with the note as the gate's output.
   */
  private async gateStep(
    run: RunRow,
    stepId: string,
    gate: { message: string; show?: string },
    context: InterpolationContext,
  ): Promise<string> {
    let answer = this.stepRow(run.id, stepId, 1);
    if (!answer) {
      const show = gate.show === undefined ? null : interpolate(gate.show, context);
      this.db
        .query(
          `INSERT INTO step_runs (run_id, step_id, attempt, type, status, output, message, started_at)
           VALUES (?, ?, 1, 'gate', 'waiting', ?, ?, ?)`,
        )
        .run(run.id, stepId, show, interpolate(gate.message, context), now());
      this.emit(run.id);
      this.setStatus(run.id, "waiting", null);
      this.host.place(run.card_id, { type: "workflow", state: "waiting" });
      this.host.release(run.card_id);
    }
    // Still open (just now, or since before a restart): wait for the answer.
    if (answer?.status !== "approved") {
      await new Promise<void>((resolve) => this.gates.set(`${run.id}/${stepId}/1`, resolve));
    }
    answer = this.stepRow(run.id, stepId, 1) as StepRow;
    if (answer.status === "rejected") {
      const note = answer.note ? `: ${answer.note}` : "";
      throw new Stop("rejected", `gate ${stepId} recusado${note}`);
    }
    // Approved while waiting: take a slot again (a run past the gate already holds one).
    if (this.row(run.id).status === "waiting") {
      await this.host.acquire(run.card_id);
      this.setStatus(run.id, "running", null);
      this.host.place(run.card_id, { type: "workflow", state: "running" });
    }
    return answer.note ?? "";
  }

  /** Runs a check of the trusted workflow; any other command never reaches the executor. */
  private async checkStep(
    run: RunRow,
    worktree: string,
    stepId: string,
    attempt: number,
    command: string,
  ): Promise<CheckResult> {
    // A check that finished before a restart keeps its result; one cut short runs again.
    const done = this.stepRow(run.id, stepId, attempt);
    if (done?.ended_at) return { exitCode: done.exit_code ?? 1, output: done.output ?? "" };
    this.db
      .query(
        `INSERT INTO step_runs (run_id, step_id, attempt, type, status, started_at)
         VALUES (?, ?, ?, 'check', 'running', ?)
         ON CONFLICT (run_id, step_id, attempt) DO UPDATE SET started_at = excluded.started_at`,
      )
      .run(run.id, stepId, attempt, now());
    this.emit(run.id);
    try {
      if (!this.allowed(run.id, command)) {
        throw new Error(`comando fora do workflow confiado: ${command}`);
      }
      const result = await this.checks.run(command, worktree);
      const status = result.exitCode === 0 ? "completed" : "failed";
      this.endStep(run.id, stepId, attempt, status, result.output, result.exitCode);
      return result;
    } catch (error) {
      this.endStep(run.id, stepId, attempt, "failed", null);
      throw new Error(`etapa ${stepId} falhou: ${reason(error)}`);
    }
  }

  /** `command` is literally a check of the run's workflow, whose content is still trusted. */
  private allowed(runId: string, command: string): boolean {
    const run = this.row(runId);
    const { projectId } = this.host.card(run.card_id);
    const intact =
      hashOf(run.definition) === run.workflow_hash &&
      this.trusted(projectId, run.workflow_name, run.workflow_hash);
    const workflow = intact ? parseWorkflow(run.definition).workflow : null;
    return workflow !== null && checkCommands(workflow).includes(command);
  }

  private async agentStep(
    run: RunRow,
    worktree: string,
    stepId: string,
    attempt: number,
    action: AgentAction,
    context: InterpolationContext,
  ): Promise<string> {
    const cut = this.stepRow(run.id, stepId, attempt);
    if (cut?.status === "completed") return cut.output ?? "";
    // Checked before every turn: a run over its budget pauses instead of spending more.
    const over = overBudget(JSON.parse(run.budget), JSON.parse(this.row(run.id).usage));
    if (over) throw new Stop("paused", over);
    // At the same point: over the plan quota, the turn waits for the window to reset.
    const quota = this.host.waitQuota();
    if (quota) {
      this.quotaWaits.set(run.id, quota.until);
      this.setStatus(run.id, "running", "aguardando cota");
      await quota.done;
      this.quotaWaits.delete(run.id);
      if (!this.active(run.id)) throw new Abandoned();
      this.setStatus(run.id, "running", null);
    }
    const prompt = interpolate(action.prompt, context);
    let target = action.continue
      ? (this.stepRow(run.id, action.continue, 1)?.session_id ?? null)
      : null;
    if (cut) {
      // The turn was cut short by a restart: same session, the prompt again with a note.
      target = cut.session_id;
    } else {
      this.db
        .query(
          `INSERT INTO step_runs (run_id, step_id, attempt, type, status, session_id, started_at)
           VALUES (?, ?, ?, 'agent', 'running', ?, ?)`,
        )
        .run(run.id, stepId, attempt, target, now());
      this.emit(run.id);
    }
    const text = cut ? `${RESUMED_NOTE}\n\n${prompt}` : prompt;
    try {
      const output = await this.turn(run, worktree, stepId, attempt, target, text, action);
      this.endStep(run.id, stepId, attempt, "completed", output);
      return output;
    } catch (error) {
      this.endStep(run.id, stepId, attempt, "failed", null);
      throw new Error(`etapa ${stepId} falhou: ${reason(error)}`);
    }
  }

  /** One turn: a new session in the worktree, or a message to the `continue` step's session. */
  private async turn(
    run: RunRow,
    worktree: string,
    stepId: string,
    attempt: number,
    target: string | null,
    prompt: string,
    action: { permissionMode?: PermissionMode; persona?: string },
  ): Promise<string> {
    const started = this.clock();
    if (target) {
      // Left `error` by a restart (or ended): reopened with the stored Claude session.
      if (STOPPED.has(this.manager.get(target).status)) await this.manager.resume(target);
      const since = this.manager.get(target).lastSeq;
      const done = this.awaitTurn(run, { stepId, attempt }, target, since, started);
      this.manager.send(target, prompt);
      return done;
    }
    const { title } = this.host.card(run.card_id);
    const persona = action.persona ? { id: action.persona } : undefined;
    const prepared = await this.preparePersonas(persona, worktree);
    const { sessionId } = await this.manager.create(
      {
        cwd: worktree,
        prompt,
        name: `${title} · ${stepId}`,
        ...(action.permissionMode ? { permissionMode: action.permissionMode } : {}),
        ...(persona ? { persona } : {}),
      },
      { prepared },
    );
    this.db
      .query("UPDATE step_runs SET session_id = ? WHERE run_id = ? AND step_id = ? AND attempt = ?")
      .run(sessionId, run.id, stepId, attempt);
    this.emit(run.id);
    return this.awaitTurn(run, { stepId, attempt }, sessionId, 0, started);
  }

  /**
   * Resolves with the assistant text of the next turn of `sessionId` (events after `since`):
   * the text blocks of every message of the turn, in order. Session statuses move the card;
   * the turn goes into the run's spending.
   */
  private awaitTurn(
    run: RunRow,
    step: { stepId: string; attempt: number },
    sessionId: string,
    since: number,
    started: number,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const texts: string[] = [];
      let settled = false;
      const settle = (done: () => void) => {
        settled = true;
        sub.unsubscribe();
        done();
      };
      const onEvent = (event: SessionEvent) => {
        if (settled) return;
        if (event.type === "session.status") {
          this.host.place(run.card_id, { type: "session", status: event.status });
        } else if (event.type === "message.assistant") {
          for (const block of event.blocks) if (block.type === "text") texts.push(block.text);
        } else if (event.type === "turn.result") {
          this.spend(run.id, step, {
            sessionId,
            costUsd: event.costUsd,
            minutes: (this.clock() - started) / 60_000,
          });
          settle(() =>
            event.isError
              ? reject(new Error(`turno terminou com erro (${event.subtype})`))
              : resolve(texts.join("\n\n")),
          );
        } else if (event.type === "session.error") {
          settle(() => reject(new Error(event.message)));
        }
      };
      const sub = this.manager.subscribe(sessionId, since, (envelope) => onEvent(envelope.event));
      for (const envelope of sub.replay) onEvent(envelope.event);
    });
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

  /** A turn goes into the run's spending and into its step's share. */
  private spend(
    runId: string,
    step: { stepId: string; attempt: number },
    turn: Parameters<typeof addTurn>[1],
  ): void {
    const before: RunSpending = JSON.parse(this.row(runId).usage);
    const spending = addTurn(before, turn);
    this.db
      .query("UPDATE workflow_runs SET usage = ? WHERE id = ?")
      .run(JSON.stringify(spending), runId);
    const row = this.stepRow(runId, step.stepId, step.attempt) as StepRow;
    const share = JSON.parse(row.usage ?? '{"turns":0,"minutes":0,"costUsd":0}');
    const usage = {
      turns: share.turns + 1,
      minutes: share.minutes + turn.minutes,
      costUsd: share.costUsd + (spending.costUsd - before.costUsd),
    };
    this.db
      .query("UPDATE step_runs SET usage = ? WHERE run_id = ? AND step_id = ? AND attempt = ?")
      .run(JSON.stringify(usage), runId, step.stepId, step.attempt);
    this.emit(runId);
  }

  private endStep(
    runId: string,
    stepId: string,
    attempt: number,
    status: StepStatus,
    output: string | null,
    exitCode: number | null = null,
  ): void {
    this.db
      .query(
        `UPDATE step_runs SET status = ?, output = ?, exit_code = ?, ended_at = ?
         WHERE run_id = ? AND step_id = ? AND attempt = ?`,
      )
      .run(status, output, exitCode, now(), runId, stepId, attempt);
    this.emit(runId);
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

  /** The run is over: the card goes to Em revisão (completed) or Esperando você. */
  private finish(run: RunRow, status: RunStatus, why: string | null): void {
    this.end(run.id, status, why);
    this.host.place(run.card_id, {
      type: "workflow",
      state: status === "completed" ? "done" : "waiting",
    });
    this.host.release(run.card_id);
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
