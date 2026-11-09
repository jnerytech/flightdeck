import type { Database } from "bun:sqlite";
import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  AutoApproveSettings,
  BoardColumn as BoardColumnSchema,
  ColumnContract,
  type ContractOverrides,
  IssuesConfig,
  isBranchName,
  type PersonaSubagentsMode,
  PersonaSubagentsMode as PersonaSubagentsModeSchema,
} from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import { resolveAllowedCwd } from "../paths.ts";
import { ulid } from "../ulid.ts";
import { git } from "./command.ts";
import { assertBranchName } from "./ref-arg.ts";
import type {
  BoardColumn,
  BoardOptions,
  NewProject,
  Project,
  ProjectPatch,
  ProjectRow,
} from "./types.ts";
import { WORKTREE_INCLUDE } from "./worktree.ts";

export const DEFAULT_PROMPT_TEMPLATE =
  "Trabalhe somente nesta worktree, sem mexer em outras pastas do repositório, e faça commits " +
  "com mensagens descritivas a cada passo concluído.";

/** A blank script means "no script": nothing is ever run unless the user registered one. */
const script = (value: string | null | undefined) => value?.trim() || null;

/** The fields of a patch that were given, so a missing one keeps its value. */
const definedOnly = <T extends object>(patch: T | undefined): Partial<T> =>
  Object.fromEntries(Object.entries(patch ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    baseBranch: row.base_branch,
    prProvider: row.pr_provider,
    setupScript: row.setup_script,
    promptTemplate: row.prompt_template,
    // The file answer needs IO: `forWire` fills it in where a project leaves for the app.
    worktreeInclude: false,
    autoApprove: AutoApproveSettings.parse(JSON.parse(row.auto_approve ?? "{}")),
    issues: row.issues ? IssuesConfig.parse(JSON.parse(row.issues)) : null,
    personaByColumn: row.persona_by_column ? JSON.parse(row.persona_by_column) : {},
    contractByColumn: row.contract_by_column ? JSON.parse(row.contract_by_column) : {},
    personaSubagents: row.persona_subagents ?? "all",
    defaultHours: row.default_hours,
    roiSignals: { commits: row.roi_commits === 1, issues: row.roi_issues === 1 },
  };
}

const PERSONA_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

function subagentsMode(mode: string): PersonaSubagentsMode {
  const parsed = PersonaSubagentsModeSchema.safeParse(mode);
  if (!parsed.success) {
    throw new FlightdeckError(
      "bad_request",
      "personaSubagents must be all, project or none",
      "persona_subagents_invalid",
    );
  }
  return parsed.data;
}

/** The contracts with the patch applied: a known column, a valid contract, `null` takes one away. */
function mergeContracts(
  current: Project["contractByColumn"],
  patch: NonNullable<ProjectPatch["contractByColumn"]>,
): Project["contractByColumn"] {
  const merged: ContractOverrides = { ...current };
  for (const [column, contract] of Object.entries(patch)) {
    if (!BoardColumnSchema.options.includes(column as BoardColumn)) {
      throw new FlightdeckError("bad_request", `unknown column: ${column}`, "column_unknown", {
        column,
      });
    }
    if (contract === null) delete merged[column as BoardColumn];
    else if (contract === undefined) continue;
    else {
      const parsed = ColumnContract.safeParse(contract);
      if (!parsed.success) {
        throw new FlightdeckError("bad_request", "invalid contract", "contract_invalid", {
          column,
        });
      }
      merged[column as BoardColumn] = parsed.data;
    }
  }
  return merged;
}

/** The default personas with the patch applied: plain ids, existing columns, `null` takes one away. */
function mergePersonas(
  current: Project["personaByColumn"],
  patch: NonNullable<ProjectPatch["personaByColumn"]>,
): Project["personaByColumn"] {
  const merged: Record<string, string> = { ...current };
  for (const [column, id] of Object.entries(patch)) {
    if (!BoardColumnSchema.options.includes(column as BoardColumn)) {
      throw new FlightdeckError("bad_request", `unknown column: ${column}`, "column_unknown", {
        column,
      });
    }
    if (id === null) delete merged[column];
    else if (id === undefined) continue;
    else if (!PERSONA_ID.test(id))
      throw new FlightdeckError("bad_request", "invalid persona id", "persona_id_invalid");
    else merged[column] = id;
  }
  return merged;
}

/**
 * Issue #1523 (the board split): the board's projects, their rows and
 * the rules a patch must keep. The board reaches them through its own methods, unchanged.
 */
export class Projects {
  constructor(
    private readonly db: Database,
    private readonly opts: Pick<BoardOptions, "allowedRoots" | "projectKeys">,
  ) {}

  list(): Project[] {
    return this.db
      .query<ProjectRow, []>("SELECT * FROM projects ORDER BY name, path")
      .all()
      .map(toProject);
  }

  /**
   * Phase 29: the project as it leaves for the app: its key and whether it has a `.worktreeinclude`. The key is asked without blocking (`resolve`
   * answers from a cache and asks git once per folder); a host without it sends none.
   */
  async forWire(project: Project): Promise<Project> {
    const [projectKey, worktreeInclude] = await Promise.all([
      this.opts.projectKeys?.resolve?.(project.path),
      stat(join(project.path, WORKTREE_INCLUDE)).then(
        () => true,
        () => false,
      ),
    ]);
    return {
      ...project,
      worktreeInclude,
      ...(projectKey ? { projectKey } : {}),
      // A base an older daemon stored without checking: the person is told to set a real one.
      ...(project.baseBranch !== "HEAD" && !isBranchName(project.baseBranch)
        ? { baseBranchInvalid: true }
        : {}),
    };
  }

  get(id: string): Project {
    const row = this.db.query<ProjectRow, [string]>("SELECT * FROM projects WHERE id = ?").get(id);
    if (!row)
      throw new FlightdeckError("not_found", `project ${id} does not exist`, "project_not_found", {
        id,
      });
    return toProject(row);
  }

  /** Registers a git repository that lives inside `allowedRoots`. */
  async add(input: NewProject): Promise<Project> {
    const path = await resolveAllowedCwd(input.path, this.opts.allowedRoots);
    const top = await git(path, "rev-parse", "--show-toplevel");
    if (top.code !== 0) {
      throw new FlightdeckError(
        "invalid_state",
        `not a git repository: ${input.path}`,
        "repo_not_git",
        { path: input.path },
      );
    }
    const taken = this.db.query("SELECT 1 FROM projects WHERE path = ?").get(path);
    if (taken)
      throw new FlightdeckError(
        "invalid_state",
        `project already registered: ${path}`,
        "project_exists",
        { path },
      );
    const head = await git(path, "rev-parse", "--abbrev-ref", "HEAD");
    const project: Omit<
      Project,
      | "worktreeInclude"
      | "personaByColumn"
      | "contractByColumn"
      | "personaSubagents"
      | "defaultHours"
      | "roiSignals"
    > = {
      id: ulid(),
      path,
      name: input.name?.trim() || basename(path),
      baseBranch: input.baseBranch?.trim()
        ? assertBranchName(input.baseBranch.trim())
        : head.stdout.trim(),
      prProvider: input.prProvider ?? "none",
      setupScript: script(input.setupScript),
      promptTemplate: input.promptTemplate ?? DEFAULT_PROMPT_TEMPLATE,
      autoApprove: AutoApproveSettings.parse(input.autoApprove ?? {}),
      issues: input.issues ?? null,
    };
    this.db
      .query(
        `INSERT INTO projects (id, path, name, base_branch, pr_provider, setup_script, prompt_template,
           auto_approve, issues)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.path,
        project.name,
        project.baseBranch,
        project.prProvider,
        project.setupScript,
        project.promptTemplate,
        JSON.stringify(project.autoApprove),
        project.issues ? JSON.stringify(project.issues) : null,
      );
    // The key of the project is looked up now, without waiting for git, so the budget check and
    // the vault find it cached when a card starts.
    await this.opts.projectKeys?.resolve?.(path);
    return await this.forWire(this.get(project.id));
  }

  update(id: string, patch: ProjectPatch): Project {
    const current = this.get(id);
    const next: Project = {
      ...current,
      ...(patch.name?.trim() ? { name: patch.name.trim() } : {}),
      ...(patch.baseBranch?.trim()
        ? { baseBranch: assertBranchName(patch.baseBranch.trim()) }
        : {}),
      ...(patch.prProvider ? { prProvider: patch.prProvider } : {}),
      ...(patch.setupScript !== undefined ? { setupScript: script(patch.setupScript) } : {}),
      ...(patch.promptTemplate !== undefined ? { promptTemplate: patch.promptTemplate } : {}),
      autoApprove: { ...current.autoApprove, ...patch.autoApprove },
      ...(patch.issues !== undefined ? { issues: patch.issues } : {}),
      ...(patch.personaByColumn
        ? { personaByColumn: mergePersonas(current.personaByColumn, patch.personaByColumn) }
        : {}),
      ...(patch.contractByColumn
        ? { contractByColumn: mergeContracts(current.contractByColumn, patch.contractByColumn) }
        : {}),
      ...(patch.personaSubagents
        ? { personaSubagents: subagentsMode(patch.personaSubagents) }
        : {}),
      ...(patch.defaultHours !== undefined ? { defaultHours: patch.defaultHours } : {}),
      roiSignals: { ...current.roiSignals, ...definedOnly(patch.roiSignals) },
    };
    this.db
      .query(
        `UPDATE projects SET name = ?, base_branch = ?, pr_provider = ?, setup_script = ?,
         prompt_template = ?, auto_approve = ?, issues = ?, persona_by_column = ?,
         contract_by_column = ?, persona_subagents = ?, default_hours = ?, roi_commits = ?, roi_issues = ? WHERE id = ?`,
      )
      .run(
        next.name,
        next.baseBranch,
        next.prProvider,
        next.setupScript,
        next.promptTemplate,
        JSON.stringify(next.autoApprove),
        next.issues ? JSON.stringify(next.issues) : null,
        JSON.stringify(next.personaByColumn),
        JSON.stringify(next.contractByColumn),
        next.personaSubagents,
        next.defaultHours,
        next.roiSignals.commits ? 1 : 0,
        next.roiSignals.issues ? 1 : 0,
        id,
      );
    return next;
  }
}
