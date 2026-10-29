import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  AutoApproveSettings,
  BoardColumn as BoardColumnSchema,
  type BoardResult,
  type PermissionUpdate,
  type SessionEvent,
  type SessionStatus,
  type WorkflowInfo,
} from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import { isInside, resolveAllowedCwd } from "../paths.ts";
import { isProjectRule } from "../permissions/permission-updates.ts";
import type { Quota } from "../quota/quota.ts";
import type { SessionManager } from "../sessions/session-manager.ts";
import { ulid } from "../ulid.ts";
import { type CheckRunner, shellCheckRunner } from "../workflows/check-runner.ts";
import { WorkflowEngine } from "../workflows/engine.ts";
import { type BoardEvent, nextColumn } from "./columns.ts";
import { git } from "./command.ts";
import { cardDiff } from "./diff.ts";
import {
  aheadBehind,
  assertLocalBranch,
  mergeIntoBase,
  pendingFiles,
  rebaseOnto,
} from "./merge.ts";
import { type PrComment, prMessage, prProvider } from "./pr.ts";
import { addRules, LOCAL_SETTINGS, readRules, removeRule, ruleString } from "./project-rules.ts";
import { runSetup } from "./setup.ts";
import type {
  BoardColumn,
  Card,
  CardDiff,
  CardRun,
  ChecksState,
  NewProject,
  Project,
  ProjectPatch,
  PrProviderKind,
  PrState,
} from "./types.ts";
import {
  addWorktree,
  excludeLocalSettings,
  must,
  WORKTREE_INCLUDE,
  WORKTREE_INCLUDE_LIMIT,
} from "./worktree.ts";

/** How often cards with an open PR ask the provider for its state and checks. */
export const DEFAULT_PR_POLL_MS = 60_000;

export const DEFAULT_PROMPT_TEMPLATE =
  "Trabalhe somente nesta worktree, sem mexer em outras pastas do repositório, e faça commits " +
  "com mensagens descritivas a cada passo concluído.";

export interface BoardOptions {
  db: Database;
  manager: SessionManager;
  allowedRoots: readonly string[];
  /** 2 when absent. */
  maxParallelRuns?: number;
  prPollIntervalMs?: number;
  /** Persists host-wide settings changed through `board.settings`. */
  onSettingsChange?: (settings: { maxParallelRuns: number }) => void;
  /** Runs workflow `check` commands; the real shell runner when absent. */
  checks?: CheckRunner;
  /** Milliseconds now, for the workflow budget's minutes; `Date.now` when absent. */
  clock?: () => number;
  /** The host's plan quota: over `pauseAt`, new cards and workflow turns wait (phase 7). */
  quota?: Quota;
  /** Budgets with `queue` (phase 8): at 100%, new cards of their scope wait. */
  budgets?: { blocked(projectKey: string): boolean; watch(listener: () => void): () => void };
  /** Phase 5's project keys, which budgets are set on; the project folder when absent. */
  projectKeys?: { keyFor(path: string): string };
  /** Bytes `.worktreeinclude` copies into a new worktree, at most; 50 MB when absent. */
  worktreeIncludeLimit?: number;
}

interface ProjectRow {
  id: string;
  path: string;
  name: string;
  base_branch: string;
  pr_provider: PrProviderKind;
  setup_script: string | null;
  prompt_template: string;
  auto_approve: string | null;
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
    worktreeInclude: existsSync(join(row.path, WORKTREE_INCLUDE)),
    autoApprove: AutoApproveSettings.parse(JSON.parse(row.auto_approve ?? "{}")),
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
  id: string;
  card_id: string;
  session_id: string | null;
  queued_at: string;
  started_at: string | null;
  ended_at: string | null;
}

const now = () => new Date().toISOString();

/** A run stops holding its slot when its session goes idle, fails or ends. */
const FREES_SLOT: ReadonlySet<SessionStatus> = new Set(["idle", "error", "ended"]);

const toRun = (row: RunRow): CardRun => ({
  sessionId: row.session_id,
  queuedAt: row.queued_at,
  startedAt: row.started_at,
  endedAt: row.ended_at,
});

/** A card's session in one of these is still working: no rebase or merge under it. */
const BUSY: ReadonlySet<string> = new Set(["starting", "running", "awaiting_permission"]);

/** A blank script means "no script": nothing is ever run unless the user registered one. */
const script = (value: string | null | undefined) => value?.trim() || null;

/**
 * Projects (git repositories of this host) and their boards. A card is a thin layer over what
 * already exists: a branch, a worktree, a session and a PR.
 */
export class Board {
  private readonly db: Database;
  /** Card id → stops following the session of its active run. */
  private readonly follows = new Map<string, () => void>();
  /** Cards holding one of the `maxParallelRuns` slots (preparing or with a turn going). */
  private readonly running = new Set<string>();
  /** Workflow turns waiting for the plan quota to free up. */
  private quotaWaiters: Array<() => void> = [];
  private readonly unwatchQuota: () => void;
  private readonly unwatchBudgets: () => void;
  /** Review comments of each card's open PR, from the last poll (phase 11). */
  private readonly prCommentCache = new Map<string, PrComment[]>();
  /** Workflow runs back from a gate, waiting for a slot; served before queued cards. */
  private readonly waiters: Array<{ cardId: string; resume(): void }> = [];
  private limit: number;
  private readonly pollTimer: ReturnType<typeof setInterval>;
  private polling = false;
  private readonly watchers = new Set<(card: Card) => void>();
  /** Workflows of the projects and their runs (phase 6). */
  readonly workflows: WorkflowEngine;

  constructor(private readonly opts: BoardOptions) {
    this.db = opts.db;
    this.workflows = new WorkflowEngine({
      db: opts.db,
      manager: opts.manager,
      host: {
        place: (cardId, event) => this.place(cardId, event),
        release: (cardId) => this.release(cardId),
        hold: (cardId) => {
          this.running.add(cardId);
        },
        acquire: (cardId) => this.acquire(cardId),
        takeSlots: (cardId, count) => this.takeSlots(cardId, count),
        waitQuota: () => this.waitQuota(),
        createPr: async (cardId) => (await this.createPr(cardId)).prUrl as string,
        card: (cardId) => this.getCard(cardId),
      },
      checks: opts.checks ?? shellCheckRunner(),
      clock: opts.clock ?? Date.now,
    });
    this.limit = opts.maxParallelRuns ?? 2;
    opts.manager.onPermissionUpdates((sessionId, updates) =>
      this.applyProjectRules(sessionId, updates),
    );
    this.unwatchQuota = opts.quota?.watch(() => this.onLimits()) ?? (() => {});
    this.unwatchBudgets = opts.budgets?.watch(() => this.onLimits()) ?? (() => {});
    this.pollTimer = setInterval(() => void this.pollPrs(), this.prPollIntervalMs);
    // Back from a restart: keep moving cards whose run still has a session.
    const active = this.db
      .query<RunRow, []>(
        "SELECT * FROM card_runs WHERE session_id IS NOT NULL AND ended_at IS NULL",
      )
      .all();
    for (const run of active) {
      const sessionId = run.session_id as string;
      this.follow(run.card_id, sessionId, opts.manager.get(sessionId).lastSeq);
    }
    // Workflow runs take their slots back before the queue moves.
    this.workflows.recover();
    this.pump();
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
    const project: Omit<Project, "worktreeInclude"> = {
      id: ulid(),
      path,
      name: input.name?.trim() || basename(path),
      baseBranch: input.baseBranch?.trim() || head.stdout.trim(),
      prProvider: input.prProvider ?? "none",
      setupScript: script(input.setupScript),
      promptTemplate: input.promptTemplate ?? DEFAULT_PROMPT_TEMPLATE,
      autoApprove: AutoApproveSettings.parse(input.autoApprove ?? {}),
    };
    this.db
      .query(
        `INSERT INTO projects (id, path, name, base_branch, pr_provider, setup_script, prompt_template,
           auto_approve)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
      );
    return this.getProject(project.id);
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
      autoApprove: { ...current.autoApprove, ...patch.autoApprove },
    };
    this.db
      .query(
        `UPDATE projects SET name = ?, base_branch = ?, pr_provider = ?, setup_script = ?,
         prompt_template = ?, auto_approve = ? WHERE id = ?`,
      )
      .run(
        next.name,
        next.baseBranch,
        next.prProvider,
        next.setupScript,
        next.promptTemplate,
        JSON.stringify(next.autoApprove),
        id,
      );
    return next;
  }

  /**
   * Phase 13: the project a folder belongs to (its repository or a card's worktree), with the
   * card when it is one; null outside every project.
   */
  projectForCwd(cwd: string): { project: Project; card: Card | null } | null {
    const card = this.db
      .query<{ id: string; worktree_path: string }, []>(
        "SELECT id, worktree_path FROM cards WHERE worktree_path IS NOT NULL",
      )
      .all()
      .find((row) => isInside(resolve(row.worktree_path), resolve(cwd)));
    if (card) {
      const found = this.getCard(card.id);
      return { project: this.getProject(found.projectId), card: found };
    }
    const project = this.listProjects().find((p) => isInside(resolve(p.path), resolve(cwd)));
    return project ? { project, card: null } : null;
  }

  getCard(id: string): Card {
    const row = this.db.query<CardRow, [string]>("SELECT * FROM cards WHERE id = ?").get(id);
    if (!row) throw new FlightdeckError("not_found", `card ${id} não existe`);
    const rows = this.db
      .query<RunRow, [string]>(
        "SELECT * FROM card_runs WHERE card_id = ? ORDER BY queued_at, rowid",
      )
      .all(id);
    const runs = rows.map(toRun);
    const active = rows.at(-1);
    const sessionId = active?.session_id ?? null;
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
      queued: active !== undefined && active.started_at === null && active.ended_at === null,
      sessionId,
      sessionStatus: sessionId ? this.opts.manager.get(sessionId).status : null,
      notice: row.notice,
      discarded: false,
      runs,
      workflowRunId: active && this.workflows.has(active.id) ? active.id : null,
      ...this.queueState(
        active !== undefined && active.started_at === null && active.ended_at === null,
        row.project_id,
      ),
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
    return this.changed(id);
  }

  /** Edits the title or the description. */
  updateCard(
    id: string,
    patch: { title?: string | undefined; description?: string | undefined },
  ): Card {
    const card = this.getCard(id);
    this.db
      .query("UPDATE cards SET title = ?, description = ?, updated_at = ? WHERE id = ?")
      .run(patch.title ?? card.title, patch.description ?? card.description, now(), id);
    return this.changed(id);
  }

  /** The project with its five columns, each with its cards by position. */
  getBoard(projectId: string): BoardResult {
    const project = this.getProject(projectId);
    const cards = this.db
      .query<{ id: string }, [string]>(
        "SELECT id FROM cards WHERE project_id = ? ORDER BY position, created_at",
      )
      .all(projectId)
      .map(({ id }) => this.getCard(id));
    const columns = BoardColumnSchema.options.map((column) => ({
      column,
      cards: cards.filter((card) => card.column === column),
    }));
    return { project, columns };
  }

  /** "Pedir ajuste": a message to the session of the active run. */
  message(id: string, text: string): { queued: boolean } {
    const { sessionId } = this.getCard(id);
    if (!sessionId) throw new FlightdeckError("invalid_state", "card sem sessão; inicie o card");
    return this.opts.manager.send(sessionId, text);
  }

  /** Gets every card after each change; returns the function that stops it. */
  watch(listener: (card: Card) => void): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  get watcherCount(): number {
    return this.watchers.size;
  }

  /**
   * Starts a new run of the card. It waits in the queue while every slot is taken; then the
   * worktree (created on the first run), the setup script and a fresh session.
   */
  async startCard(
    id: string,
    options: { workflow?: string | undefined; inputs?: Record<string, string> | undefined } = {},
  ): Promise<Card> {
    const card = this.getCard(id);
    if (card.queued || this.running.has(id)) {
      throw new FlightdeckError("invalid_state", `card ${id} já está na fila ou em execução`);
    }
    if (card.workflowRunId && this.workflows.active(card.workflowRunId)) {
      throw new FlightdeckError(
        "invalid_state",
        "o card tem uma execução de workflow em andamento",
      );
    }
    const runId = ulid();
    if (options.workflow) {
      const project = this.getProject(card.projectId);
      await this.workflows.prepare(id, runId, project, options.workflow, options.inputs ?? {});
    }
    this.db
      .query("INSERT INTO card_runs (id, card_id, queued_at) VALUES (?, ?, ?)")
      .run(runId, id, now());
    this.db.query("UPDATE cards SET notice = NULL WHERE id = ?").run(id);
    this.place(id, { type: "started" });
    this.pump();
    return this.changed(id);
  }

  /** Starts queued runs, oldest first, while there are free slots. */
  private pump(): void {
    while (this.running.size < this.limit) {
      const waiter = this.waiters.shift();
      if (waiter) {
        this.running.add(waiter.cardId);
        waiter.resume();
        continue;
      }
      // Over the plan quota, queued cards wait for the window to reset (runs going on do not).
      if (this.opts.quota?.blocked()) return;
      // The oldest queued card whose budget lets it go: a held project never stalls the others.
      const next = this.db
        .query<RunRow & { project_id: string }, []>(
          `SELECT r.*, c.project_id FROM card_runs r JOIN cards c ON c.id = r.card_id
           WHERE r.started_at IS NULL AND r.ended_at IS NULL ORDER BY r.queued_at, r.rowid`,
        )
        .all()
        .find((run) => !this.budgetBlocked(run.project_id));
      if (!next) return;
      this.running.add(next.card_id);
      this.db.query("UPDATE card_runs SET started_at = ? WHERE id = ?").run(now(), next.id);
      this.changed(next.card_id);
      void this.launch(next.card_id, next.id).catch((error: unknown) =>
        this.failRun(next.card_id, next.id, error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /** Why a queued card waits, for the card itself: the quota, then a budget, then a slot. */
  private queueState(queued: boolean, projectId: string): Pick<Card, "queueReason" | "quotaUntil"> {
    const blocked = queued ? this.opts.quota?.blocked() : null;
    if (blocked) {
      const until = blocked.until === null ? null : new Date(blocked.until).toISOString();
      return { queueReason: "quota", quotaUntil: until };
    }
    if (queued && this.budgetBlocked(projectId)) return { queueReason: "budget", quotaUntil: null };
    return { queueReason: queued ? "slot" : null, quotaUntil: null };
  }

  /** A `queue` budget of the host or of the card's project is at 100%. */
  private budgetBlocked(projectId: string): boolean {
    if (!this.opts.budgets) return false;
    const { path } = this.getProject(projectId);
    return this.opts.budgets.blocked(this.opts.projectKeys?.keyFor(path) ?? path);
  }

  /** A workflow turn about to start over the quota waits for it; `null` when it may go. */
  private waitQuota(): { until: number | null; done: Promise<void> } | null {
    const blocked = this.opts.quota?.blocked();
    if (!blocked) return null;
    return {
      until: blocked.until,
      done: new Promise((resolve) => this.quotaWaiters.push(resolve)),
    };
  }

  /** A new quota reading, a reset or a budget change: queued cards may go, or say why not. */
  private onLimits(): void {
    if (!this.opts.quota?.blocked()) {
      for (const resume of this.quotaWaiters.splice(0)) resume();
    }
    this.pump();
    const queued = this.db
      .query<{ card_id: string }, []>(
        "SELECT DISTINCT card_id FROM card_runs WHERE started_at IS NULL AND ended_at IS NULL",
      )
      .all();
    for (const { card_id } of queued) this.changed(card_id);
  }

  /** A slot for a card whose workflow run goes on after a gate. */
  private acquire(cardId: string): Promise<void> {
    return new Promise((resume) => {
      this.waiters.push({ cardId, resume });
      this.pump();
    });
  }

  /** Free slots taken right away for the items of a parallel step, each under its own key. */
  private takeSlots(cardId: string, count: number): string[] {
    const keys: string[] = [];
    while (keys.length < count && this.running.size < this.limit) {
      const key = `${cardId}/${ulid()}`;
      this.running.add(key);
      keys.push(key);
    }
    return keys;
  }

  /** The card's run stopped holding a slot: the next one in the queue goes. */
  private release(cardId: string): void {
    if (this.running.delete(cardId)) this.pump();
  }

  /** Nothing reached the agent: the run ends and the card waits for the user with the error. */
  private failRun(id: string, runId: string, notice: string): void {
    this.workflows.fail(runId, notice);
    this.db.query("UPDATE cards SET notice = ? WHERE id = ?").run(notice, id);
    this.place(id, { type: "failed" });
    this.db.query("UPDATE card_runs SET ended_at = ? WHERE id = ?").run(now(), runId);
    this.changed(id);
    this.release(id);
  }

  private async launch(id: string, runId: string): Promise<void> {
    const card = this.getCard(id);
    const project = this.getProject(card.projectId);
    let worktree = card.worktreePath;
    if (!worktree) {
      const limit = this.opts.worktreeIncludeLimit ?? WORKTREE_INCLUDE_LIMIT;
      const added = await addWorktree(project.path, card.title, project.baseBranch, limit);
      worktree = added.path;
      const left = added.skipped.length;
      const notice =
        left === 0
          ? null
          : `${left === 1 ? "1 arquivo do .worktreeinclude não copiado" : `${left} arquivos do .worktreeinclude não copiados`}: passou do limite de ${Math.round((limit / 1024 / 1024) * 100) / 100} MB`;
      this.db
        .query(
          "UPDATE cards SET slug = ?, branch = ?, worktree_path = ?, notice = ?, updated_at = ? WHERE id = ?",
        )
        .run(added.slug, added.branch, added.path, notice, now(), id);
      this.changed(id);
    }
    excludeLocalSettings(project.path);
    if (project.setupScript) await runSetup(project.setupScript, worktree);
    // The newest run is the active one: older sessions of the card are closed.
    await this.closeRuns(id, runId);
    // A workflow run executes its steps instead of sending the description to one session.
    if (this.workflows.has(runId)) return this.workflows.begin(runId, worktree);
    const prompt = [card.description, project.promptTemplate]
      .filter((part) => part.trim())
      .join("\n\n");
    const { sessionId } = this.opts.manager.create({ cwd: worktree, prompt, name: card.title });
    this.db.query("UPDATE card_runs SET session_id = ? WHERE id = ?").run(sessionId, runId);
    this.changed(id);
    this.follow(id, sessionId, 0);
  }

  /** Closes the card's sessions and ends its open runs, except `keep` (the one launching). */
  private async closeRuns(id: string, keep = ""): Promise<void> {
    const open = this.db
      .query<RunRow, [string, string]>(
        "SELECT * FROM card_runs WHERE card_id = ? AND id <> ? AND ended_at IS NULL",
      )
      .all(id, keep);
    for (const run of open) {
      if (run.session_id) await this.opts.manager.close(run.session_id);
      this.db.query("UPDATE card_runs SET ended_at = ? WHERE id = ?").run(now(), run.id);
    }
    this.workflows.abandon(id, "execução encerrada com o card", keep);
    await this.workflows.closeSessions(id, keep);
  }

  /** The card is done: sessions closed, worktree removed unless something is still pending. */
  private async finish(id: string): Promise<void> {
    await this.closeRuns(id);
    await this.removeCleanWorktree(id);
    this.changed(id);
  }

  private async removeCleanWorktree(id: string): Promise<void> {
    const card = this.getCard(id);
    if (!card.worktreePath) return;
    const pending = must(await git(card.worktreePath, "status", "--porcelain"), "git status");
    if (pending.stdout.trim()) {
      this.db
        .query("UPDATE cards SET notice = ? WHERE id = ?")
        .run("worktree com alterações pendentes: não foi removida", id);
      return;
    }
    const repo = this.getProject(card.projectId).path;
    must(await git(repo, "worktree", "remove", card.worktreePath), "git worktree remove");
    this.db.query("UPDATE cards SET worktree_path = NULL, notice = NULL WHERE id = ?").run(id);
  }

  /** Moves the card by hand; Backlog and Concluído lock it there until the next start. */
  moveCard(id: string, column: BoardColumn, position?: number): Card {
    const card = this.getCard(id);
    const { last } = this.db
      .query<{ last: number | null }, [string, string, string]>(
        "SELECT MAX(position) AS last FROM cards WHERE project_id = ? AND board_column = ? AND id <> ?",
      )
      .get(card.projectId, column, id) ?? { last: null };
    this.place(id, { type: "moved", column });
    this.db
      .query("UPDATE cards SET position = ? WHERE id = ?")
      .run(position ?? (last ?? 0) + 1, id);
    return this.changed(id);
  }

  /**
   * A queued card leaves the queue and goes back to the Backlog. A running one has its turn
   * interrupted, and the interrupted turn sends it to Esperando você.
   */
  async stopCard(id: string): Promise<Card> {
    const card = this.getCard(id);
    if (card.queued) {
      this.db
        .query("UPDATE card_runs SET ended_at = ? WHERE card_id = ? AND started_at IS NULL")
        .run(now(), id);
      this.workflows.abandon(id, "card parado antes de começar");
      this.place(id, { type: "moved", column: "backlog" });
    } else if (card.workflowRunId) {
      await this.workflows.interrupt(card.workflowRunId);
    } else if (card.sessionId) {
      await this.opts.manager.interrupt(card.sessionId);
    }
    return this.changed(id);
  }

  /** The project's rules: `permissions.allow` of its root `.claude/settings.local.json`. */
  listRules(projectId: string): string[] {
    return readRules(this.getProject(projectId).path);
  }

  /** Removes one rule of the project, keeping the rest of the file; only with `confirm`. */
  removeRule(projectId: string, rule: string, confirm: boolean): string[] {
    if (!confirm) {
      throw new FlightdeckError("invalid_state", "confirme a remoção da regra com confirm: true");
    }
    return removeRule(this.getProject(projectId).path, rule);
  }

  /**
   * Project rules accepted in a card's session (its run or a workflow step) also go to the
   * repository root's settings.local.json, which every new worktree of the project copies.
   */
  private applyProjectRules(sessionId: string, updates: PermissionUpdate[]): void {
    const rules = updates.filter(isProjectRule).flatMap((update) => update.rules.map(ruleString));
    const card = this.db
      .query<{ card_id: string }, [string, string]>(
        `SELECT card_id FROM card_runs WHERE session_id = ?1
         UNION SELECT r.card_id FROM step_runs s JOIN workflow_runs r ON r.id = s.run_id
         WHERE s.session_id = ?2 LIMIT 1`,
      )
      .get(sessionId, sessionId);
    if (rules.length === 0 || !card) return;
    try {
      const repo = this.getProject(this.getCard(card.card_id).projectId).path;
      excludeLocalSettings(repo);
      addRules(repo, rules);
    } catch (error) {
      const notice = `regra não gravada no ${LOCAL_SETTINGS}: ${(error as Error).message}`;
      this.db.query("UPDATE cards SET notice = ? WHERE id = ?").run(notice, card.card_id);
      this.changed(card.card_id);
    }
  }

  /** Workflows on the project's base branch, with validation and trust. */
  listWorkflows(projectId: string): Promise<WorkflowInfo[]> {
    return this.workflows.list(this.getProject(projectId));
  }

  /** One workflow of the project's base branch, with its validation. */
  validateWorkflow(projectId: string, name: string): Promise<WorkflowInfo> {
    return this.workflows.validate(this.getProject(projectId), name);
  }

  /** Trusts the workflow's current content (`hash`), which lets its `check` commands run. */
  trustWorkflow(projectId: string, name: string, hash: string): Promise<WorkflowInfo> {
    return this.workflows.trust(this.getProject(projectId), name, hash);
  }

  /** Commits since the base plus uncommitted changes, per file. */
  async diff(id: string): Promise<CardDiff> {
    const card = this.getCard(id);
    if (!card.worktreePath) throw new FlightdeckError("invalid_state", "card ainda sem worktree");
    return cardDiff(card.worktreePath, this.getProject(card.projectId).baseBranch);
  }

  /** Pushes the card's branch to `origin` and opens the PR with the card's title and description. */
  async createPr(id: string): Promise<Card> {
    const card = this.getCard(id);
    const project = this.getProject(card.projectId);
    const provider = prProvider(project.prProvider);
    if (!provider) throw new FlightdeckError("invalid_state", "projeto sem provedor de PR");
    const { worktreePath: cwd, branch } = card;
    if (!cwd || !branch) throw new FlightdeckError("invalid_state", "card ainda sem worktree");
    must(await git(cwd, "push", "-u", "origin", branch), "git push");
    const url = await provider.create({
      cwd,
      base: project.baseBranch,
      head: branch,
      title: card.title,
      body: card.description,
    });
    this.db
      .query(
        "UPDATE cards SET pr_url = ?, pr_state = 'open', checks_state = NULL, notice = NULL WHERE id = ?",
      )
      .run(url, id);
    this.place(id, { type: "pr", state: "open" });
    return this.getCard(id);
  }

  /** The review comments of the card's PR, as last fetched (fetched now when there are none). */
  async prComments(id: string): Promise<PrComment[]> {
    if (!this.getCard(id).prUrl) throw new FlightdeckError("invalid_state", "card sem PR");
    return this.prCommentCache.get(id) ?? this.fetchPrComments(id);
  }

  /** Asks the provider; read only, nothing is posted back. */
  private async fetchPrComments(id: string): Promise<PrComment[]> {
    const card = this.getCard(id);
    const project = this.getProject(card.projectId);
    const provider = prProvider(project.prProvider);
    if (!provider) throw new FlightdeckError("invalid_state", "projeto sem provedor de PR");
    const comments = await provider.comments({ cwd: project.path, url: card.prUrl as string });
    this.prCommentCache.set(id, comments);
    return comments;
  }

  /** Sends the chosen PR comments to the card's session, in the review's format. */
  async sendPrComments(id: string, ids: readonly string[]): Promise<{ sent: number }> {
    const chosen = (await this.prComments(id)).filter((c) => ids.includes(c.id));
    if (chosen.length === 0)
      throw new FlightdeckError("bad_request", "nenhum comentário escolhido");
    this.message(id, prMessage(chosen));
    return { sent: chosen.length };
  }

  /** The card's worktree and branch, while no turn of its agent is going on. */
  private idleWorktree(id: string): { card: Card; worktree: string; branch: string } {
    const card = this.getCard(id);
    if (!card.worktreePath || !card.branch) {
      throw new FlightdeckError("invalid_state", "card ainda sem worktree");
    }
    if (card.queued || (card.sessionStatus !== null && BUSY.has(card.sessionStatus))) {
      throw new FlightdeckError("invalid_state", "card em execução: espere o agente terminar");
    }
    return { card, worktree: card.worktreePath, branch: card.branch };
  }

  /** Rebases the card's branch on its base; a conflict aborts and leaves the worktree as it was. */
  async updateFromBase(id: string): Promise<Card> {
    const { card, worktree } = this.idleWorktree(id);
    await rebaseOnto(worktree, this.getProject(card.projectId).baseBranch);
    return this.changed(id);
  }

  /**
   * "Merge e arquivar" for a card without a PR: into the base where it is checked out (clean), or
   * through a temporary worktree; then the card's worktree and branch go and it is Concluído.
   */
  async mergeLocal(id: string, mode: "merge" | "squash", confirm: boolean): Promise<Card> {
    if (!confirm) throw new FlightdeckError("invalid_state", "confirme o merge com confirm: true");
    const { card, worktree, branch } = this.idleWorktree(id);
    if (card.prUrl) {
      throw new FlightdeckError("invalid_state", "card com PR: ele é concluído pelo PR");
    }
    const pending = await pendingFiles(worktree);
    if (pending.length > 0) {
      throw new FlightdeckError(
        "invalid_state",
        `worktree do card com mudanças não commitadas: ${pending.join(", ")}`,
      );
    }
    const project = this.getProject(card.projectId);
    const base = project.baseBranch;
    await assertLocalBranch(project.path, base);
    const { ahead } = await aheadBehind(worktree, base);
    if (ahead === 0) throw new FlightdeckError("invalid_state", `nada à frente de ${base}`);
    const message = mode === "squash" ? card.title : `Merge ${branch}: ${card.title}`;
    await mergeIntoBase(project.path, base, branch, mode, message);
    // The merge is in the base now and cannot be undone: nothing below may leave the card out of
    // Concluído. What could not be cleaned up stays on the card as a notice.
    await this.closeRuns(id);
    const left = await this.removeMerged(project.path, worktree, branch);
    this.db
      .query("UPDATE cards SET worktree_path = ?, branch = ?, notice = ? WHERE id = ?")
      .run(left.worktree ? worktree : null, left.branch ? branch : null, left.notice, id);
    this.place(id, { type: "moved", column: "done" });
    return this.changed(id);
  }

  /**
   * Removes a merged card's worktree, then its branch (git does not delete a branch checked out
   * somewhere). A failure of either is reported, not thrown: on Windows a process may hold the
   * folder, and the merge is already in the base.
   */
  private async removeMerged(
    repo: string,
    worktree: string,
    branch: string,
  ): Promise<{ worktree: boolean; branch: boolean; notice: string | null }> {
    const removed = await git(repo, "worktree", "remove", worktree);
    if (removed.code !== 0) {
      const notice = `a pasta da worktree ficou em ${worktree}; remova depois (a branch ${branch} sai junto)`;
      return { worktree: true, branch: true, notice };
    }
    const deleted = await git(repo, "branch", "-D", branch);
    if (deleted.code !== 0) {
      const notice = `a branch ${branch} ficou (${deleted.stderr.trim()}); apague depois`;
      return { worktree: false, branch: true, notice };
    }
    return { worktree: false, branch: false, notice: null };
  }

  /** Manual completion: Concluído (locked) and the same cleanup as a merged PR. */
  async completeCard(id: string, confirm: boolean): Promise<Card> {
    if (!confirm)
      throw new FlightdeckError("invalid_state", "confirme a conclusão com confirm: true");
    this.place(id, { type: "moved", column: "done" });
    await this.finish(id);
    return this.getCard(id);
  }

  /**
   * Throws the card away: sessions closed, worktree removed even with changes, local branch
   * deleted, card off the board. Returns its last state, marked `discarded`.
   */
  async discardCard(id: string, confirm: boolean): Promise<Card> {
    if (!confirm)
      throw new FlightdeckError("invalid_state", "confirme o descarte com confirm: true");
    const card = this.getCard(id);
    await this.closeRuns(id);
    this.follows.get(id)?.();
    this.follows.delete(id);
    const repo = this.getProject(card.projectId).path;
    if (card.worktreePath) {
      must(
        await git(repo, "worktree", "remove", "--force", card.worktreePath),
        "git worktree remove",
      );
    }
    if (card.branch) must(await git(repo, "branch", "-D", card.branch), "git branch -D");
    const last = this.getCard(id);
    this.workflows.forget(id);
    this.db.query("DELETE FROM card_runs WHERE card_id = ?").run(id);
    this.db.query("DELETE FROM cards WHERE id = ?").run(id);
    const discarded = { ...last, worktreePath: null, branch: null, discarded: true };
    this.emit(discarded);
    return discarded;
  }

  get prPollIntervalMs(): number {
    return this.opts.prPollIntervalMs ?? DEFAULT_PR_POLL_MS;
  }

  /** Asks the provider about every card with an open PR; one round at a time. */
  async pollPrs(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const open = this.db
        .query<{ id: string }, []>("SELECT id FROM cards WHERE pr_state = 'open'")
        .all();
      for (const { id } of open) {
        await this.pollPr(id).catch((error: unknown) => {
          const notice = error instanceof Error ? error.message : String(error);
          this.db.query("UPDATE cards SET notice = ? WHERE id = ?").run(notice, id);
          // The card may have been discarded while the provider was answering.
          if (this.db.query("SELECT 1 FROM cards WHERE id = ?").get(id)) this.changed(id);
        });
      }
    } finally {
      this.polling = false;
    }
  }

  private async pollPr(id: string): Promise<void> {
    const card = this.getCard(id);
    const project = this.getProject(card.projectId);
    const provider = prProvider(project.prProvider);
    if (!provider || !card.prUrl) return;
    // From the main repository: a cwd inside the worktree would lock it while it is removed.
    const cwd = project.path;
    const { state, checks } = await provider.status({ cwd, url: card.prUrl });
    this.db
      .query("UPDATE cards SET pr_state = ?, checks_state = ?, notice = NULL WHERE id = ?")
      .run(state, checks, id);
    this.changed(id);
    if (state !== card.prState) this.place(id, { type: "pr", state });
    // The comments come in the same round; a failure keeps the last ones, quietly.
    if (state === "open") await this.fetchPrComments(id).catch(() => {});
    if (state === "merged") await this.finish(id);
  }

  get maxParallelRuns(): number {
    return this.limit;
  }

  /** A higher limit starts queued cards right away; a lower one lets running ones finish. */
  setMaxParallelRuns(value: number): void {
    this.limit = value;
    this.opts.onSettingsChange?.({ maxParallelRuns: value });
    this.pump();
  }

  stop(): void {
    clearInterval(this.pollTimer);
    this.unwatchQuota();
    this.unwatchBudgets();
    for (const unfollow of this.follows.values()) unfollow();
    this.follows.clear();
  }

  // -- internals ------------------------------------------------------------

  private place(id: string, event: BoardEvent): void {
    const card = this.getCard(id);
    const next = nextColumn({ column: card.column, locked: card.columnLocked }, event);
    this.db
      .query("UPDATE cards SET board_column = ?, column_locked = ?, updated_at = ? WHERE id = ?")
      .run(next.column, next.locked ? 1 : 0, now(), id);
    this.changed(id);
  }

  /** Sends the card as it is now to every watcher, and returns it. */
  private changed(id: string): Card {
    const card = this.getCard(id);
    this.emit(card);
    return card;
  }

  private emit(card: Card): void {
    for (const watcher of this.watchers) {
      try {
        watcher(card);
      } catch {
        // A broken watcher must not break the board.
      }
    }
  }

  /** Session events of the card's active run move the card (replay first, then live). */
  private follow(cardId: string, sessionId: string, sinceSeq: number): void {
    this.follows.get(cardId)?.();
    const sub = this.opts.manager.subscribe(sessionId, sinceSeq, (envelope) =>
      this.onSessionEvent(cardId, envelope.event),
    );
    this.follows.set(cardId, sub.unsubscribe);
    for (const envelope of sub.replay) this.onSessionEvent(cardId, envelope.event);
  }

  private onSessionEvent(cardId: string, event: SessionEvent): void {
    if (event.type === "session.status")
      this.place(cardId, { type: "session", status: event.status });
    if (event.type === "turn.result") this.place(cardId, { type: "turn", isError: event.isError });
    if (event.type === "session.status" && FREES_SLOT.has(event.status)) this.release(cardId);
  }
}
