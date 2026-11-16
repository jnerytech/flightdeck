import type { Database } from "bun:sqlite";
import type {
  Card,
  Project,
  RunResumeCheck,
  WorkflowInfo,
  WorkflowRun,
} from "@flightdeck/protocol";
import { inSequence } from "@flightdeck/protocol";
import { FlightdeckError } from "../kernel/index.ts";
import { withoutPersonas } from "../personas/index.ts";
import { noSpending } from "./domain/budget.ts";
import { parseWorkflow } from "./domain/schema.ts";
import { type EngineHost, now, type RunRow, type WorkflowEngineOptions } from "./engine-types.ts";
import { WorkflowRegistry } from "./registry.ts";
import { gitHead, RunResumes } from "./resume.ts";
import { RunStore } from "./run-store.ts";
import { StepRunner } from "./step-runner.ts";

/** Workflows of the projects: catalog read from the base branch, trust and runs. */
export class WorkflowEngine {
  private readonly db: Database;
  private readonly manager: WorkflowEngineOptions["manager"];
  private readonly host: EngineHost;
  /** Open gates of this process, by `run/step/attempt`: wakes the run when answered. */
  private readonly gates = new Map<string, () => void>();
  /** Runs waiting for the plan quota before an agent turn: until when (ms), if known. */
  private readonly quotaWaits = new Map<string, number | null>();
  /** #1595: the steps of a run, executed with the engine's stores and state. */
  private readonly steps: StepRunner;
  /** The catalog and the trust of the workflows: a run starts only from a trusted hash. */
  private readonly registry: WorkflowRegistry;
  /** The runs as rows and their watchers: the engine and the steps both go through it. */
  private readonly store: RunStore;
  /** #1266: the resume of failed runs, and the recovery of the resumes a restart cut. */
  private readonly resumes: RunResumes;

  constructor(opts: WorkflowEngineOptions) {
    this.db = opts.db;
    this.registry = new WorkflowRegistry(opts.db);
    this.store = new RunStore(opts.db, this.quotaWaits);
    this.manager = opts.manager;
    this.host = opts.host;
    this.resumes = new RunResumes({
      db: this.db,
      host: this.host,
      store: this.store,
      registry: this.registry,
      headOf: opts.headOf ?? gitHead,
      begin: (runId, worktree) => this.begin(runId, worktree),
      cardOrNull: (cardId) => this.cardOrNull(cardId),
    });
    this.steps = new StepRunner({
      db: this.db,
      manager: this.manager,
      preparePersonas: opts.preparePersonas ?? withoutPersonas,
      host: this.host,
      checks: opts.checks,
      clock: opts.clock,
      gates: this.gates,
      quotaWaits: this.quotaWaits,
      store: this.store,
      trusted: (projectId, name, hash) => this.registry.trusted(projectId, name, hash),
      recordHead: (runId, worktree) => this.resumes.recordHead(runId, worktree),
    });
  }

  async list(project: Project): Promise<WorkflowInfo[]> {
    return this.registry.list(project);
  }

  /** Trusts the workflow's current content; `hash` is what the user reviewed. */
  async trust(project: Project, name: string, hash: string): Promise<WorkflowInfo> {
    return this.registry.trust(project, name, hash);
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
    const source = await this.registry.source(project, name);
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
    if (!this.registry.trusted(project.id, name, source.hash)) {
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
    this.store.emit(runId);
  }

  /** Whether `runId` (a card run) is a workflow run. */
  has(runId: string): boolean {
    return this.db.query("SELECT 1 FROM workflow_runs WHERE id = ?").get(runId) !== null;
  }

  /** The card's worktree is ready and its slot taken: the run executes its steps. */
  begin(runId: string, worktree: string): void {
    this.store.setStatus(runId, "running", null);
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
        this.store.end(run.id, "failed", "the run's card is gone");
        this.store.setReasonKey(run.id, "run_card_gone", {});
        continue;
      }
      // At a gate the run holds no slot; it takes one again once the gate is approved.
      if (run.status === "running") this.host.hold(run.card_id);
      void this.steps.execute(run.id, card.worktreePath);
    }
    // #1266: a resume that was waiting for its slot waits again, with the HEAD it was given.
    this.resumes.recoverQueued();
  }

  private cardOrNull(cardId: string): Card | null {
    try {
      return this.host.card(cardId);
    } catch {
      return null;
    }
  }

  /**
   * Nothing reached an agent (worktree or setup failed); the board moves the card itself. A card
   * run that is not a workflow run has nothing here to fail: the board ends it alone (#3404).
   */
  fail(
    runId: string,
    why: string,
    refusal: { reason: string; params?: Record<string, string | number> } | null = null,
  ): void {
    if (!this.has(runId)) return;
    this.store.end(runId, "failed", why);
    if (refusal) this.store.setReasonKey(runId, refusal.reason, refusal.params ?? {});
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
      this.store.end(run.id, "failed", why);
      if (run.status === "running") this.host.release(cardId);
    }
  }

  /** Whether a failed run can resume, and from which step: see `RunResumes.check`. */
  async resumeCheck(runId: string, project: Project): Promise<RunResumeCheck> {
    return this.resumes.check(runId, project);
  }

  /** Resumes a failed run in place (#1266): see `RunResumes.resume`. */
  async resume(runId: string, project: Project): Promise<RunResumeCheck> {
    return this.resumes.resume(runId, project);
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
    this.store.row(runId);
    const step = this.store.stepRow(runId, stepId, attempt);
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
    this.store.emit(runId);
    const key = `${runId}/${stepId}/${attempt}`;
    this.gates.get(key)?.();
    this.gates.delete(key);
  }

  /** Gets every run after each change; returns the function that stops it. */
  watch(listener: (run: WorkflowRun) => void): () => void {
    return this.store.watch(listener);
  }

  /** Runs still going, for a watcher that just arrived. */
  activeRuns(): WorkflowRun[] {
    return this.store.activeRuns();
  }

  /** The workflow as it is on the base branch, with its validation. */
  async validate(project: Project, name: string): Promise<WorkflowInfo> {
    return this.registry.validate(project, name);
  }

  /** Whether the run is still going (queued, running or at a gate). */
  active(runId: string): boolean {
    return this.store.active(runId);
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
    return this.store.getRun(id);
  }
}
