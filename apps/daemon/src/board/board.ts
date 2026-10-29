import type { Database } from "bun:sqlite";
import { basename } from "node:path";
import { FlightdeckError } from "../errors.ts";
import { resolveAllowedCwd } from "../paths.ts";
import type { SessionManager } from "../sessions/session-manager.ts";
import { ulid } from "../ulid.ts";
import { git } from "./command.ts";
import { runSetup } from "./setup.ts";
import type {
  BoardColumn,
  Card,
  CardRun,
  ChecksState,
  NewProject,
  Project,
  ProjectPatch,
  PrProviderKind,
  PrState,
} from "./types.ts";
import { addWorktree } from "./worktree.ts";

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

interface CardRow {
  id: string;
  project_id: string;
  title: string;
  description: string;
  board_column: BoardColumn;
  column_locked: number;
  position: number;
  slug: string | null;
  branch: string | null;
  worktree_path: string | null;
  pr_url: string | null;
  pr_state: PrState | null;
  checks_state: ChecksState | null;
  notice: string | null;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  card_id: string;
  session_id: string;
  queued_at: string;
  started_at: string | null;
  ended_at: string | null;
}

const now = () => new Date().toISOString();

const toRun = (row: RunRow): CardRun => ({
  sessionId: row.session_id || null,
  queuedAt: row.queued_at,
  startedAt: row.started_at,
  endedAt: row.ended_at,
});

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

  getCard(id: string): Card {
    const row = this.db.query<CardRow, [string]>("SELECT * FROM cards WHERE id = ?").get(id);
    if (!row) throw new FlightdeckError("not_found", `card ${id} não existe`);
    const runs = this.db
      .query<RunRow, [string]>(
        "SELECT * FROM card_runs WHERE card_id = ? ORDER BY queued_at, rowid",
      )
      .all(id)
      .map(toRun);
    const active = runs.at(-1);
    const sessionId = active?.sessionId ?? null;
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      column: row.board_column,
      columnLocked: row.column_locked === 1,
      position: row.position,
      slug: row.slug,
      branch: row.branch,
      worktreePath: row.worktree_path,
      prUrl: row.pr_url,
      prState: row.pr_state,
      checksState: row.checks_state,
      queued: active !== undefined && active.startedAt === null,
      sessionId,
      sessionStatus: sessionId ? this.opts.manager.get(sessionId).status : null,
      notice: row.notice,
      discarded: false,
      runs,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** A new card goes to the end of the Backlog. */
  createCard(projectId: string, input: { title: string; description: string }): Card {
    this.getProject(projectId);
    const { last } = this.db
      .query<{ last: number | null }, [string]>(
        "SELECT MAX(position) AS last FROM cards WHERE project_id = ? AND board_column = 'backlog'",
      )
      .get(projectId) ?? { last: null };
    const id = ulid();
    const at = now();
    this.db
      .query(
        `INSERT INTO cards (id, project_id, title, description, board_column, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'backlog', ?, ?, ?)`,
      )
      .run(id, projectId, input.title, input.description, (last ?? 0) + 1, at, at);
    return this.getCard(id);
  }

  /** Starts a new run of the card: worktree (created on the first run) and a fresh session. */
  async startCard(id: string): Promise<Card> {
    this.getCard(id);
    const at = now();
    this.db
      .query(
        "INSERT INTO card_runs (card_id, session_id, queued_at, started_at) VALUES (?, '', ?, ?)",
      )
      .run(id, at, at);
    void this.launch(id).catch((error: unknown) =>
      this.failRun(id, error instanceof Error ? error.message : String(error)),
    );
    return this.getCard(id);
  }

  /** Nothing reached the agent: the run ends and the card waits for the user with the error. */
  private failRun(id: string, notice: string): void {
    this.db
      .query(
        "UPDATE cards SET board_column = 'waiting', column_locked = 0, notice = ?, updated_at = ? WHERE id = ?",
      )
      .run(notice, now(), id);
    this.db
      .query("UPDATE card_runs SET ended_at = ? WHERE card_id = ? AND session_id = ''")
      .run(now(), id);
  }

  private async launch(id: string): Promise<void> {
    const card = this.getCard(id);
    const project = this.getProject(card.projectId);
    let worktree = card.worktreePath;
    if (!worktree) {
      const added = await addWorktree(project.path, card.title, project.baseBranch);
      worktree = added.path;
      this.db
        .query(
          "UPDATE cards SET slug = ?, branch = ?, worktree_path = ?, updated_at = ? WHERE id = ?",
        )
        .run(added.slug, added.branch, added.path, now(), id);
    }
    if (project.setupScript) await runSetup(project.setupScript, worktree);
    const prompt = [card.description, project.promptTemplate]
      .filter((part) => part.trim())
      .join("\n\n");
    const { sessionId } = this.opts.manager.create({ cwd: worktree, prompt, name: card.title });
    this.db
      .query("UPDATE card_runs SET session_id = ? WHERE card_id = ? AND session_id = ''")
      .run(sessionId, id);
  }

  stop(): void {}
}
