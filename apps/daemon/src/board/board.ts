import type { Database } from "bun:sqlite";
import { basename } from "node:path";
import { FlightdeckError } from "../errors.ts";
import { resolveAllowedCwd } from "../paths.ts";
import type { SessionManager } from "../sessions/session-manager.ts";
import { ulid } from "../ulid.ts";
import { git } from "./command.ts";
import type { NewProject, Project, ProjectPatch, PrProviderKind } from "./types.ts";

export const DEFAULT_PROMPT_TEMPLATE =
  "Trabalhe somente nesta worktree, sem mexer em outras pastas do repositório, e faça commits " +
  "com mensagens descritivas a cada passo concluído.";

export interface BoardOptions {
  db: Database;
  manager: SessionManager;
  allowedRoots: readonly string[];
}

interface ProjectRow {
  id: string;
  path: string;
  name: string;
  base_branch: string;
  pr_provider: PrProviderKind;
  setup_script: string | null;
  prompt_template: string;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    baseBranch: row.base_branch,
    prProvider: row.pr_provider,
    setupScript: row.setup_script,
    promptTemplate: row.prompt_template,
  };
}

/** A blank script means "no script": nothing is ever run unless the user registered one. */
const script = (value: string | null | undefined) => value?.trim() || null;

/**
 * Projects (git repositories of this host) and their boards. A card is a thin layer over what
 * already exists: a branch, a worktree, a session and a PR.
 */
export class Board {
  private readonly db: Database;

  constructor(private readonly opts: BoardOptions) {
    this.db = opts.db;
  }

  listProjects(): Project[] {
    return this.db
      .query<ProjectRow, []>("SELECT * FROM projects ORDER BY name, path")
      .all()
      .map(toProject);
  }

  getProject(id: string): Project {
    const row = this.db.query<ProjectRow, [string]>("SELECT * FROM projects WHERE id = ?").get(id);
    if (!row) throw new FlightdeckError("not_found", `projeto ${id} não existe`);
    return toProject(row);
  }

  /** Registers a git repository that lives inside `allowedRoots`. */
  async addProject(input: NewProject): Promise<Project> {
    const path = resolveAllowedCwd(input.path, this.opts.allowedRoots);
    const top = await git(path, "rev-parse", "--show-toplevel");
    if (top.code !== 0) {
      throw new FlightdeckError("invalid_state", `não é um repositório git: ${input.path}`);
    }
    const taken = this.db.query("SELECT 1 FROM projects WHERE path = ?").get(path);
    if (taken) throw new FlightdeckError("invalid_state", `projeto já cadastrado: ${path}`);
    const head = await git(path, "rev-parse", "--abbrev-ref", "HEAD");
    const project: Project = {
      id: ulid(),
      path,
      name: input.name?.trim() || basename(path),
      baseBranch: input.baseBranch?.trim() || head.stdout.trim(),
      prProvider: input.prProvider ?? "none",
      setupScript: script(input.setupScript),
      promptTemplate: input.promptTemplate ?? DEFAULT_PROMPT_TEMPLATE,
    };
    this.db
      .query(
        `INSERT INTO projects (id, path, name, base_branch, pr_provider, setup_script, prompt_template)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.path,
        project.name,
        project.baseBranch,
        project.prProvider,
        project.setupScript,
        project.promptTemplate,
      );
    return project;
  }

  updateProject(id: string, patch: ProjectPatch): Project {
    const current = this.getProject(id);
    const next: Project = {
      ...current,
      ...(patch.name?.trim() ? { name: patch.name.trim() } : {}),
      ...(patch.baseBranch?.trim() ? { baseBranch: patch.baseBranch.trim() } : {}),
      ...(patch.prProvider ? { prProvider: patch.prProvider } : {}),
      ...(patch.setupScript !== undefined ? { setupScript: script(patch.setupScript) } : {}),
      ...(patch.promptTemplate !== undefined ? { promptTemplate: patch.promptTemplate } : {}),
    };
    this.db
      .query(
        `UPDATE projects SET name = ?, base_branch = ?, pr_provider = ?, setup_script = ?,
         prompt_template = ? WHERE id = ?`,
      )
      .run(next.name, next.baseBranch, next.prProvider, next.setupScript, next.promptTemplate, id);
    return next;
  }

  stop(): void {}
}
