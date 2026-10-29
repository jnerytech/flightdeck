import type { Database } from "bun:sqlite";
import type { WorkflowInfo } from "@flightdeck/protocol";
import type { Project } from "../board/types.ts";
import { FlightdeckError } from "../errors.ts";
import { type WorkflowSource, workflowSources } from "./repo.ts";
import { checkCommands, parseWorkflow } from "./schema.ts";

export interface WorkflowEngineOptions {
  db: Database;
}

const now = () => new Date().toISOString();

/** Workflows of the projects: catalog read from the base branch, trust and runs. */
export class WorkflowEngine {
  private readonly db: Database;

  constructor(opts: WorkflowEngineOptions) {
    this.db = opts.db;
  }

  async list(project: Project): Promise<WorkflowInfo[]> {
    const sources = await workflowSources(project.path, project.baseBranch);
    return sources.map((source) => this.info(project.id, source));
  }

  /** Trusts the workflow's current content; `hash` is what the user reviewed. */
  async trust(project: Project, name: string, hash: string): Promise<WorkflowInfo> {
    const source = await this.source(project, name);
    if (source.hash !== hash) {
      throw new FlightdeckError(
        "invalid_state",
        `o workflow ${name} mudou; revise os comandos de novo antes de confiar`,
      );
    }
    if (parseWorkflow(source.source).errors.length > 0) {
      throw new FlightdeckError("invalid_state", `workflow ${name} tem erros de validação`);
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
   * that is not on the base branch, has validation errors or whose content is not trusted.
   */
  async prepare(
    cardId: string,
    runId: string,
    project: Project,
    name: string,
    inputs: Record<string, string>,
  ): Promise<void> {
    const source = await this.source(project, name);
    const { workflow, errors } = parseWorkflow(source.source);
    if (!workflow) {
      throw new FlightdeckError(
        "invalid_state",
        `workflow ${name} tem erros de validação: ${errors.join("; ")}`,
      );
    }
    if (!this.trusted(project.id, name, source.hash)) {
      throw new FlightdeckError(
        "invalid_state",
        `workflow ${name} não confiado; confie nele na tela de workflows`,
      );
    }
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
        JSON.stringify({ turns: 0, minutes: 0, costUsd: 0 }),
        JSON.stringify(inputs),
        now(),
      );
  }

  /** Whether `runId` (a card run) is a workflow run. */
  has(runId: string): boolean {
    return this.db.query("SELECT 1 FROM workflow_runs WHERE id = ?").get(runId) !== null;
  }

  private async source(project: Project, name: string): Promise<WorkflowSource> {
    const sources = await workflowSources(project.path, project.baseBranch);
    const source = sources.find((s) => s.name === name);
    if (!source) {
      throw new FlightdeckError(
        "not_found",
        `workflow ${name} não existe na branch ${project.baseBranch}`,
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
    const { workflow, errors } = parseWorkflow(source.source);
    return {
      name: source.name,
      hash: source.hash,
      trusted: this.trusted(projectId, source.name, source.hash),
      checks: workflow ? checkCommands(workflow) : [],
      errors,
      inputs: workflow?.inputs ?? [],
    };
  }
}
