import type { Database } from "bun:sqlite";
import type { Project, WorkflowInfo } from "@flightdeck/protocol";
import { FlightdeckError, refArg } from "../kernel/index.ts";
import { checkCommands, parseWorkflow } from "./domain/schema.ts";
import { now } from "./engine-types.ts";
import { type WorkflowSource, workflowSources } from "./repo.ts";

/**
 * The workflows of the projects as the user sees them (#1589): the catalog read from the base
 * branch, its validation and the trust a person gave to a workflow's content. A run starts only
 * from a trusted hash; the runs themselves are the engine's.
 */
export class WorkflowRegistry {
  constructor(private readonly db: Database) {}

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

  /** The workflow as it is on the base branch, with its validation. */
  async validate(project: Project, name: string): Promise<WorkflowInfo> {
    return this.info(project.id, await this.source(project, name));
  }

  async source(project: Project, name: string): Promise<WorkflowSource> {
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

  trusted(projectId: string, name: string, hash: string): boolean {
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
