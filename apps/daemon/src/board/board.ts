import type { Database } from "bun:sqlite";
import { stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  type Arena,
  type ArenaVariant,
  AutoApproveSettings,
  BoardColumn as BoardColumnSchema,
  type BoardResult,
  type EffortLevel,
  IssuesConfig,
  type PermissionUpdate,
  type PersonaRef,
  type PersonaSubagentsMode,
  PersonaSubagentsMode as PersonaSubagentsModeSchema,
  type SessionEvent,
  type SessionStatus,
  type UnblockWhen,
  type WorkflowInfo,
} from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import { closingLine, parseIssueRef, providerOfRef } from "../issues/providers.ts";
import { isInside, resolveAllowedCwd } from "../paths.ts";
import { isProjectRule } from "../permissions/permission-updates.ts";
import { type Prepare, withoutPersonas } from "../personas/prepare.ts";
import type { Quota } from "../quota/quota.ts";
import { type DoneVia, forgetDone, recordDone } from "../roi/done-log.ts";
import type { SessionManager } from "../sessions/session-manager.ts";
import type { SecretScanner } from "../snippets/model.ts";
import { ulid } from "../ulid.ts";
import { type CheckRunner, shellCheckRunner } from "../workflows/check-runner.ts";
import { WorkflowEngine } from "../workflows/engine.ts";
import { folderRemoving } from "../worktrees/locks.ts";
import { type BoardEvent, nextColumn } from "./columns.ts";
import { git } from "./command.ts";
import { cyclePath, MAX_BLOCKERS } from "./deps.ts";
import { cardDiff } from "./diff.ts";
import {
  aheadBehind,
  assertLocalBranch,
  mergeIntoBase,
  pendingFiles,
  rebaseOnto,
} from "./merge.ts";
import { type PrComment, type PrProvider, prMessage, prProvider } from "./pr.ts";
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
  excludeLocalSettingsAsync,
  freshBase,
  must,
  WORKTREE_INCLUDE,
  WORKTREE_INCLUDE_LIMIT,
} from "./worktree.ts";

/** How often cards with an open PR ask the provider for its state and checks. */
export const DEFAULT_PR_POLL_MS = 60_000;

/** How a fix run (phase 22) ended: its first turn's result. */
export interface FixResult {
  sessionId: string | null;
  costUsd: number;
  isError: boolean;
  error: string | null;
}

const PENDING_NOTICE = "worktree com alterações pendentes: não foi removida";

export const DEFAULT_PROMPT_TEMPLATE =
  "Trabalhe somente nesta worktree, sem mexer em outras pastas do repositório, e faça commits " +
  "com mensagens descritivas a cada passo concluído.";

export interface BoardOptions {
  db: Database;
  manager: SessionManager;
  /** Reads the personas for a session about to open; none when absent. */
  preparePersonas?: Prepare;
  allowedRoots: readonly string[];
  /** Folders being removed (issue #152): no card starts in one. */
  folderLocks?: { isHeld(cwd: string): boolean };
  /** 2 when absent. */
  maxParallelRuns?: number;
  prPollIntervalMs?: number;
  /** Persists host-wide settings changed through `board.settings`. */
  onSettingsChange?: (settings: { maxParallelRuns: number }) => void | Promise<void>;
  /** Runs workflow `check` commands; the real shell runner when absent. */
  checks?: CheckRunner;
  /** Milliseconds now, for the workflow budget's minutes; `Date.now` when absent. */
  clock?: () => number;
  /** The host's plan quota: over `pauseAt`, new cards and workflow turns wait (phase 7). */
  quota?: Quota;
  /** Budgets with `queue` (phase 8): at 100%, new cards of their scope wait. */
  budgets?: { blocked(projectKey: string): boolean; watch(listener: () => void): () => void };
  /** Phase 13: the estimated cost of a card's sessions, for the arena's comparison. */
  cardCost?: (cardId: string) => number | null;
  /** Phase 22: refuses a PR description that carries a secret. */
  scanner?: Pick<SecretScanner, "scan">;
  /** Phase 13: the PR host of a kind of project; the real CLIs when absent (tests inject). */
  prProvider?: (kind: PrProviderKind) => PrProvider | null;
  /** Phase 5's project keys, which budgets are set on; the project folder when absent. */
  projectKeys?: { known(path: string): string; resolve?(path: string): Promise<string> };
  /** Bytes `.worktreeinclude` copies into a new worktree, at most; 50 MB when absent. */
  worktreeIncludeLimit?: number;
  /** Settles when no background git work (phase 12's snapshots) runs in a worktree to remove. */
  idle?: () => Promise<void>;
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
  issues: string | null;
  persona_by_column: string | null;
  persona_subagents: PersonaSubagentsMode | null;
  default_hours: number | null;
  roi_commits: number;
  roi_issues: number;
}

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

/** The auto-start as the cards table keeps it. */
const autoStartOf = (autoStart: { workflow: string | null } | null | undefined) =>
  autoStart ? JSON.stringify(autoStart) : null;

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
  notice_reason: string | null;
  notice_params: string | null;
  issue_ref: string | null;
  issue_external: number;
  external_url: string | null;
  external_gone: number;
  estimate_hours: number | null;
  arena_of: string | null;
  variant: string | null;
  unblock_when: UnblockWhen;
  auto_start: string | null;
  unblocked_at: string | null;
  waiting: number;
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
/** The reason and params of a refusal; `null` for any other error. */
export function refusalOf(
  error: unknown,
): { reason: string; params?: Record<string, string | number> } | null {
  if (!(error instanceof FlightdeckError) || !error.reason) return null;
  return error.params ? { reason: error.reason, params: error.params } : { reason: error.reason };
}

export class Board {
  private readonly db: Database;
  /** Card id → stops following the session of its active run. */
  private readonly waits: Array<() => Promise<unknown>> = [];
  /** The rule files being written, one after the other: two writes never read the same file. */
  private ruleWrites: Promise<void> = Promise.resolve();
  private readonly ends: Array<(cardId: string) => Promise<unknown>> = [];
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
  /** Runs while a PR is open or a merge waits to be finished; see `armPoll`. */
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly prRoundListeners = new Set<() => void>();
  private polling = false;
  /** Set by stop(): the database may be closed, so a start still in flight writes nothing. */
  private stopped = false;
  private readonly watchers = new Set<(card: Card) => void>();
  /** Phase 22: the fix runs waiting for their first turn to end, by card. */
  private readonly fixes = new Map<string, (result: FixResult) => void>();
  private readonly checkWatchers = new Set<(cardId: string, failed: string[]) => void>();
  /** Workflows of the projects and their runs (phase 6). */
  readonly workflows: WorkflowEngine;

  constructor(private readonly opts: BoardOptions) {
    this.db = opts.db;
    this.workflows = new WorkflowEngine({
      db: opts.db,
      manager: opts.manager,
      ...(opts.preparePersonas ? { preparePersonas: opts.preparePersonas } : {}),
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
    opts.manager.onPermissionUpdates((sessionId, updates) => {
      this.ruleWrites = this.ruleWrites.then(() => this.applyProjectRules(sessionId, updates));
    });
    this.unwatchQuota = opts.quota?.watch(() => this.onLimits()) ?? (() => {});
    this.unwatchBudgets = opts.budgets?.watch(() => this.onLimits()) ?? (() => {});
    this.armPoll();
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
    // A blocker that finished while the daemon was down ends its dependents' wait now.
    for (const { id } of this.db
      .query<{ id: string }, []>("SELECT id FROM cards WHERE waiting = 1")
      .all()) {
      this.afterBlockerChange(id);
    }
    this.pump();
  }

  listProjects(): Project[] {
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
    return { ...project, worktreeInclude, ...(projectKey ? { projectKey } : {}) };
  }

  getProject(id: string): Project {
    const row = this.db.query<ProjectRow, [string]>("SELECT * FROM projects WHERE id = ?").get(id);
    if (!row)
      throw new FlightdeckError("not_found", `projeto ${id} não existe`, "project_not_found", {
        id,
      });
    return toProject(row);
  }

  /** Registers a git repository that lives inside `allowedRoots`. */
  async addProject(input: NewProject): Promise<Project> {
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
      "worktreeInclude" | "personaByColumn" | "personaSubagents" | "defaultHours" | "roiSignals"
    > = {
      id: ulid(),
      path,
      name: input.name?.trim() || basename(path),
      baseBranch: input.baseBranch?.trim() || head.stdout.trim(),
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
    return await this.forWire(this.getProject(project.id));
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
      ...(patch.issues !== undefined ? { issues: patch.issues } : {}),
      ...(patch.personaByColumn
        ? { personaByColumn: mergePersonas(current.personaByColumn, patch.personaByColumn) }
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
         persona_subagents = ?, default_hours = ?, roi_commits = ?, roi_issues = ? WHERE id = ?`,
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
        next.personaSubagents,
        next.defaultHours,
        next.roiSignals.commits ? 1 : 0,
        next.roiSignals.issues ? 1 : 0,
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
    if (!row)
      throw new FlightdeckError("not_found", `card ${id} does not exist`, "card_not_found", { id });
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
      noticeReason: row.notice_reason,
      noticeParams: row.notice_params ? JSON.parse(row.notice_params) : null,
      discarded: false,
      runs,
      workflowRunId: active && this.workflows.has(active.id) ? active.id : null,
      arenaOf: row.arena_of,
      variant: row.variant ? JSON.parse(row.variant) : null,
      arenaVariants: this.db
        .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM cards WHERE arena_of = ?")
        .get(id)?.n as number,
      issueRef: row.issue_ref,
      issueExternal: row.issue_external === 1,
      externalUrl: row.external_url,
      externalGone: row.external_gone === 1,
      estimateHours: row.estimate_hours,
      blockedBy: this.blockersOf(id),
      blocking: this.blockingOf(id),
      waitingOn: rows.length === 0 ? this.unsatisfied(id, row.unblock_when) : [],
      unblockWhen: row.unblock_when,
      autoStart: row.auto_start ? JSON.parse(row.auto_start) : null,
      unblockedAt: row.unblocked_at,
      ...this.queueState(
        active !== undefined && active.started_at === null && active.ended_at === null,
        row.project_id,
      ),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** A new card goes to the end of the Backlog. */
  createCard(
    projectId: string,
    input: {
      title: string;
      description: string;
      issueRef?: string;
      issueExternal?: boolean;
      /** Phase 31: what the card waits for. */
      blockedBy?: string[];
      unblockWhen?: UnblockWhen;
      autoStart?: { workflow: string | null } | null;
      /** An arena variant: the arena's card, and what makes it different. */
      arenaOf?: string;
      variant?: {
        label: string;
        model: string | null;
        effort: EffortLevel | null;
        /** Phase 20: the id of the persona the variant runs in. */
        persona?: string | null;
      };
    },
  ): Card {
    this.getProject(projectId);
    const blockedBy = input.blockedBy ?? [];
    this.checkBlockers(null, projectId, blockedBy);
    const { last } = this.db
      .query<{ last: number | null }, [string]>(
        "SELECT MAX(position) AS last FROM cards WHERE project_id = ? AND board_column = 'backlog'",
      )
      .get(projectId) ?? { last: null };
    const id = ulid();
    const at = now();
    this.db
      .query(
        `INSERT INTO cards (id, project_id, title, description, board_column, position, issue_ref,
           issue_external, arena_of, variant, unblock_when, auto_start, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'backlog', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        projectId,
        input.title,
        input.description,
        (last ?? 0) + 1,
        input.issueRef ?? null,
        input.issueExternal ? 1 : 0,
        input.arenaOf ?? null,
        input.variant ? JSON.stringify(input.variant) : null,
        input.unblockWhen ?? "done",
        autoStartOf(input.autoStart),
        at,
        at,
      );
    this.storeBlockers(id, blockedBy);
    this.noteWaiting(id);
    for (const blocker of blockedBy) this.changed(blocker);
    return this.changed(id);
  }

  /**
   * "Iniciar em arena": the same request in 2 to 4 variants. Each is a card of its own, hidden
   * from the board, with its own worktree (`fd/<slug>-a`, `-b`…), session, queue entry and
   * slot, so the arena takes one slot per variant and a variant without one waits its turn.
   * Model and effort apply to plain requests; a workflow defines its own.
   */
  async startArena(
    cardId: string,
    input: {
      variants: Array<{
        model?: string | undefined;
        effort?: EffortLevel | undefined;
        persona?: PersonaRef | undefined;
      }>;
      workflow?: string | undefined;
      inputs?: Record<string, string> | undefined;
    },
  ): Promise<Arena> {
    const card = this.getCard(cardId);
    this.refuseIfBlocked(card);
    if (input.variants.length < 2 || input.variants.length > 4) {
      throw new FlightdeckError("bad_request", "an arena has 2 to 4 variants", "arena_variants");
    }
    if (card.arenaOf || card.arenaVariants > 0) {
      throw new FlightdeckError(
        "invalid_state",
        "the card is already in an arena",
        "arena_in_arena",
      );
    }
    if (card.queued || card.worktreePath || this.running.has(cardId)) {
      throw new FlightdeckError(
        "invalid_state",
        "the card was already started: an arena starts from a new card",
        "card_started",
      );
    }
    const made: string[] = [];
    try {
      for (const [i, wanted] of input.variants.entries()) {
        const label = "abcd"[i] as string;
        const variant = this.createCard(card.projectId, {
          title: `${card.title} (${label})`,
          description: card.description,
          arenaOf: cardId,
          variant: {
            label,
            model: wanted.model ?? null,
            effort: wanted.effort ?? null,
            persona: wanted.persona?.id ?? wanted.persona?.definition?.id ?? null,
          },
        });
        made.push(variant.id);
        await this.startCard(variant.id, {
          workflow: input.workflow,
          inputs: input.inputs,
          persona: wanted.persona,
        });
      }
    } catch (error) {
      // Half an arena is nothing: the variants already made go, and the card stays as it was.
      for (const id of made) await this.discardCard(id, true);
      throw error;
    }
    this.place(cardId, { type: "started" });
    this.changed(cardId);
    return this.arena(cardId);
  }

  /** The comparison: each variant's diff, workflow checks, cost, duration and state. */
  async arena(cardId: string): Promise<Arena> {
    this.getCard(cardId);
    const ids = this.variantIds(cardId);
    return { cardId, variants: await Promise.all(ids.map((id) => this.variantView(id))) };
  }

  private variantIds(cardId: string): string[] {
    return this.db
      .query<{ id: string }, [string]>(
        "SELECT id FROM cards WHERE arena_of = ? ORDER BY created_at, rowid",
      )
      .all(cardId)
      .map((row) => row.id);
  }

  private async variantView(id: string): Promise<ArenaVariant> {
    const card = this.getCard(id);
    const startedAt = card.runs[0]?.startedAt ?? null;
    const finished = card.sessionStatus !== null && FREES_SLOT.has(card.sessionStatus);
    const endedAt = card.runs.at(-1)?.endedAt ?? (finished ? card.updatedAt : null);
    const files = card.worktreePath
      ? (await this.diff(id)).files.map(({ path, additions, deletions }) => ({
          path,
          additions,
          deletions,
        }))
      : [];
    const steps = card.workflowRunId ? this.workflows.getRun(card.workflowRunId).steps : [];
    return {
      id,
      label: card.variant?.label ?? "?",
      model: card.variant?.model ?? null,
      effort: card.variant?.effort ?? null,
      persona: card.variant?.persona ?? null,
      branch: card.branch,
      worktreePath: card.worktreePath,
      queued: card.queued,
      sessionStatus: card.sessionStatus,
      column: card.column,
      startedAt,
      endedAt,
      durationMs: startedAt
        ? Math.max(0, Date.parse(endedAt ?? new Date().toISOString()) - Date.parse(startedAt))
        : null,
      costUsd: this.opts.cardCost?.(id) ?? null,
      files,
      checks: steps
        .filter((step) => step.type === "check")
        .map((step) => ({ stepId: step.stepId, status: step.status })),
      notice: card.notice,
    };
  }

  /**
   * "Escolher": the variant becomes the card's worktree, branch and runs, and carries on as a
   * normal card; the other variants are stopped and removed. Only a variant that has stopped.
   */
  async chooseVariant(cardId: string, variantId: string, confirm: boolean): Promise<Card> {
    if (!confirm) {
      throw new FlightdeckError(
        "invalid_state",
        "choosing a variant removes the others: confirm first",
        "arena_choose_confirm",
      );
    }
    this.getCard(cardId);
    const ids = this.variantIds(cardId);
    if (!ids.includes(variantId)) {
      throw new FlightdeckError(
        "not_found",
        `variant ${variantId} is not in this arena`,
        "arena_variant_unknown",
        { variant: variantId },
      );
    }
    const chosen = this.getCard(variantId);
    const working =
      chosen.queued ||
      this.running.has(variantId) ||
      (chosen.workflowRunId !== null && this.workflows.active(chosen.workflowRunId));
    if (working) {
      throw new FlightdeckError(
        "invalid_state",
        "the variant is still running: wait for it to finish",
        "arena_variant_running",
      );
    }
    for (const id of ids) if (id !== variantId) await this.discardCard(id, true);
    this.follows.get(variantId)?.();
    this.follows.delete(variantId);
    this.db.transaction(() => {
      for (const table of ["card_runs", "workflow_runs"]) {
        this.db.query(`UPDATE ${table} SET card_id = ? WHERE card_id = ?`).run(cardId, variantId);
      }
      this.db
        .query(
          `UPDATE cards SET slug = ?, branch = ?, worktree_path = ?, board_column = ?,
           column_locked = ?, notice = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          chosen.slug,
          chosen.branch,
          chosen.worktreePath,
          chosen.column,
          chosen.columnLocked ? 1 : 0,
          chosen.notice,
          now(),
          cardId,
        );
      this.db.query("DELETE FROM cards WHERE id = ?").run(variantId);
    })();
    const moved = this.getCard(cardId);
    if (moved.sessionId) this.follow(cardId, moved.sessionId, 0);
    return this.changed(cardId);
  }

  /** The card already made from an issue of the project, if any. */
  cardForIssue(projectId: string, issueRef: string): string | null {
    const row = this.db
      .query<{ id: string }, [string, string]>(
        "SELECT id FROM cards WHERE project_id = ? AND lower(issue_ref) = lower(?)",
      )
      .get(projectId, issueRef);
    return row?.id ?? null;
  }

  /** Edits the title or the description. */
  updateCard(
    id: string,
    patch: {
      title?: string | undefined;
      description?: string | undefined;
      /** Phase 36: `null` removes the estimate. */
      estimateHours?: number | null | undefined;
      blockedBy?: string[] | undefined;
      unblockWhen?: UnblockWhen | undefined;
      autoStart?: { workflow: string | null } | null | undefined;
    },
  ): Card {
    const card = this.getCard(id);
    if (patch.blockedBy) this.checkBlockers(id, card.projectId, patch.blockedBy);
    this.db
      .query(
        `UPDATE cards SET title = ?, description = ?, estimate_hours = ?, unblock_when = ?, auto_start = ?,
           updated_at = ? WHERE id = ?`,
      )
      .run(
        patch.title ?? card.title,
        patch.description ?? card.description,
        patch.estimateHours === undefined ? card.estimateHours : patch.estimateHours,
        patch.unblockWhen ?? card.unblockWhen,
        autoStartOf(patch.autoStart === undefined ? card.autoStart : patch.autoStart),
        now(),
        id,
      );
    if (patch.blockedBy) {
      const changed = new Set([...card.blockedBy, ...patch.blockedBy]);
      this.storeBlockers(id, patch.blockedBy);
      this.noteWaiting(id);
      for (const blocker of changed) this.changed(blocker);
    }
    return this.changed(id);
  }

  /** The cards that must be done before `id`, in the order the person set them. */
  private blockersOf(id: string): string[] {
    return this.db
      .query<{ blocker_id: string }, [string]>(
        "SELECT blocker_id FROM card_blockers WHERE card_id = ? ORDER BY position",
      )
      .all(id)
      .map((row) => row.blocker_id);
  }

  /** The blockers of `id` that are not satisfied: not in Done, or, with merged, not merged. */
  private unsatisfied(id: string, when: UnblockWhen): string[] {
    return this.blockersOf(id).filter((blocker) => {
      const row = this.db
        .query<{ board_column: BoardColumn; pr_state: PrState | null }, [string]>(
          "SELECT board_column, pr_state FROM cards WHERE id = ?",
        )
        .get(blocker);
      if (row?.board_column !== "done") return true;
      return when === "merged" && row?.pr_state !== "merged";
    });
  }

  /** The one gate of phase 31: a card with blockers not satisfied does not start. */
  private refuseIfBlocked(card: Card): void {
    if (card.waitingOn.length === 0) return;
    const blockers = card.waitingOn.map((id) => this.getCard(id).title).join(", ");
    throw new FlightdeckError(
      "invalid_state",
      `card ${card.id} is blocked by: ${blockers}`,
      "card_blocked",
      { blockers },
    );
  }

  /** Phase 31: the person dismisses the "unblocked" mark. */
  dismissUnblocked(id: string): Card {
    this.getCard(id);
    this.db.query("UPDATE cards SET unblocked_at = NULL WHERE id = ?").run(id);
    return this.changed(id);
  }

  /**
   * What the end of a card's wait does, once: the last blocker was satisfied (or went away). With
   * auto-start the card starts like any other start, through the queue; without it the card gets
   * the mark. `waiting` is what tells the end of a wait from a card that was never blocked.
   */
  private afterBlockerChange(id: string): void {
    const row = this.db.query<CardRow, [string]>("SELECT * FROM cards WHERE id = ?").get(id);
    if (!row) return;
    const hasRun = this.db.query("SELECT 1 FROM card_runs WHERE card_id = ?").get(id) !== null;
    const waiting = !hasRun && this.unsatisfied(id, row.unblock_when).length > 0;
    if (waiting) {
      if (row.waiting === 0) this.db.query("UPDATE cards SET waiting = 1 WHERE id = ?").run(id);
      return;
    }
    if (row.waiting === 0) return;
    this.db.query("UPDATE cards SET waiting = 0 WHERE id = ?").run(id);
    if (hasRun) return;
    const auto = row.auto_start
      ? (JSON.parse(row.auto_start) as { workflow: string | null })
      : null;
    if (!auto) {
      this.db.query("UPDATE cards SET unblocked_at = ? WHERE id = ?").run(now(), id);
      return;
    }
    void this.startCard(id, auto.workflow ? { workflow: auto.workflow } : {}).catch(
      (error: unknown) => {
        if (this.stopped) return;
        const why = error instanceof Error ? error.message : String(error);
        this.db
          .query("UPDATE cards SET notice = ?, unblocked_at = ? WHERE id = ?")
          .run(`Auto-start failed: ${why}`, now(), id);
        this.setNoticeReason(id, error);
        this.changed(id);
      },
    );
  }

  /** A change the person made to the links: the wait is noted, and nothing starts or is marked. */
  private noteWaiting(id: string): void {
    const row = this.getCard(id);
    this.db
      .query("UPDATE cards SET waiting = ? WHERE id = ?")
      .run(row.waitingOn.length > 0 ? 1 : 0, id);
  }

  /** The cards `id` holds up. */
  private blockingOf(id: string): string[] {
    return this.db
      .query<{ card_id: string }, [string]>(
        "SELECT card_id FROM card_blockers WHERE blocker_id = ? ORDER BY rowid",
      )
      .all(id)
      .map((row) => row.card_id);
  }

  /**
   * Refuses a set of blockers before anything is written: a card that is not there, one of
   * another project, too many, or a cycle (`id` is `null` for a card not made yet, which cannot
   * be in one).
   */
  private checkBlockers(id: string | null, projectId: string, blockers: readonly string[]): void {
    if (blockers.length > MAX_BLOCKERS) {
      throw new FlightdeckError(
        "invalid_state",
        `a card has at most ${MAX_BLOCKERS} blockers`,
        "blocker_limit",
        { max: MAX_BLOCKERS },
      );
    }
    for (const blocker of blockers) {
      if (this.getCard(blocker).projectId !== projectId) {
        throw new FlightdeckError(
          "invalid_state",
          `card ${blocker} is in another project`,
          "blocker_other_project",
        );
      }
    }
    if (id === null) return;
    // The stored links, except the ones this card is about to replace.
    const stored = (of: string) => (of === id ? [] : this.blockersOf(of));
    for (const blocker of blockers) {
      const path = cyclePath(id, blocker, stored);
      if (path) {
        const cycle = path.map((card) => this.getCard(card).title).join(" → ");
        throw new FlightdeckError("invalid_state", `a cycle: ${cycle}`, "blocker_cycle", {
          cycle,
        });
      }
    }
  }

  /** Replaces the blockers of `id` with `blockers`, in that order. */
  private storeBlockers(id: string, blockers: readonly string[]): void {
    this.db.transaction(() => {
      this.db.query("DELETE FROM card_blockers WHERE card_id = ?").run(id);
      const insert = this.db.query(
        "INSERT INTO card_blockers (card_id, blocker_id, position) VALUES (?, ?, ?)",
      );
      for (const [position, blocker] of blockers.entries()) insert.run(id, blocker, position);
    })();
  }

  /** The project with its five columns, each with its cards by position. */
  getBoard(projectId: string): BoardResult {
    const project = this.getProject(projectId);
    const cards = this.db
      .query<{ id: string }, [string]>(
        "SELECT id FROM cards WHERE project_id = ? AND arena_of IS NULL ORDER BY position, created_at",
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
    if (!sessionId)
      throw new FlightdeckError(
        "invalid_state",
        "the card has no session: start the card",
        "card_no_session",
      );
    return this.opts.manager.send(sessionId, text);
  }

  /**
   * Phase 13: told when a card's PR checks turn to failing (not on every poll that finds them
   * failing), with the names that failed; returns the function that stops it.
   */
  onChecksFailing(listener: (cardId: string, failed: string[]) => void): () => void {
    this.checkWatchers.add(listener);
    return () => this.checkWatchers.delete(listener);
  }

  /**
   * Phase 22: a run with a prompt of its own (it waits in the same queue, quota and budgets as
   * any run), in a session nobody sits in; settled when its first turn ends.
   */
  async fixCard(
    id: string,
    opts: { prompt: string; persona?: PersonaRef | undefined },
  ): Promise<FixResult> {
    const settled = new Promise<FixResult>((resolve) => this.fixes.set(id, resolve));
    try {
      await this.startCard(id, {
        fix: { prompt: opts.prompt },
        ...(opts.persona ? { persona: opts.persona } : {}),
      });
    } catch (error) {
      this.fixes.delete(id);
      throw error;
    }
    return settled;
  }

  private settleFix(id: string, result: Partial<FixResult>): void {
    const done = this.fixes.get(id);
    if (!done) return;
    this.fixes.delete(id);
    done({
      sessionId: this.getCard(id).sessionId,
      costUsd: 0,
      isError: false,
      error: null,
      ...result,
    });
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
    options: {
      workflow?: string | undefined;
      inputs?: Record<string, string> | undefined;
      /** The persona to open the session in; else the default of the card's column. */
      persona?: PersonaRef | undefined;
      /** Phase 22 (`fixCard`): the run's prompt, instead of the card's description. */
      fix?: { prompt: string } | undefined;
    } = {},
  ): Promise<Card> {
    const card = this.getCard(id);
    // A fix run answers a PR that exists already: it is never held back by the card's blockers.
    if (!options.fix) this.refuseIfBlocked(card);
    if (card.queued || this.running.has(id)) {
      throw new FlightdeckError(
        "invalid_state",
        `card ${id} is already queued or running`,
        "card_queued",
        { id },
      );
    }
    if (card.workflowRunId && this.workflows.active(card.workflowRunId)) {
      throw new FlightdeckError(
        "invalid_state",
        "the card has a workflow run in progress",
        "card_workflow_running",
      );
    }
    const runId = ulid();
    if (options.workflow) {
      const project = this.getProject(card.projectId);
      await this.workflows.prepare(id, runId, project, options.workflow, options.inputs ?? {});
    }
    // Asked for in the start, else the default of the column the card is in; kept with the run
    // because the session only opens when the run leaves the queue.
    const standard = this.getProject(card.projectId).personaByColumn[card.column];
    const persona = options.persona ?? (standard ? { id: standard } : null);
    this.db
      .query(
        "INSERT INTO card_runs (id, card_id, queued_at, persona, fix_prompt) VALUES (?, ?, ?, ?, ?)",
      )
      .run(runId, id, now(), persona ? JSON.stringify(persona) : null, options.fix?.prompt ?? null);
    this.db.query("UPDATE cards SET notice = NULL, unblocked_at = NULL WHERE id = ?").run(id);
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
      void this.launch(next.card_id, next.id).catch((error: unknown) => {
        // After stop() the failure is the shutdown's (a closed database): nothing to record.
        if (this.stopped) return;
        this.failRun(
          next.card_id,
          next.id,
          error instanceof Error ? error.message : String(error),
          error,
        );
      });
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

  /** Another thing to wait for before a worktree is removed, besides `idle` (the run environment's trees). */
  addIdle(wait: () => Promise<unknown>): void {
    this.waits.push(wait);
  }

  /** Something that ends what runs in a card's worktree, asked before a discarded card's worktree goes. */
  addEnd(end: (cardId: string) => Promise<unknown>): void {
    this.ends.push(end);
  }

  /** Everything a worktree must wait for before it is removed. */
  private async settle(): Promise<void> {
    await this.opts.idle?.();
    await Promise.all(this.waits.map((wait) => wait()));
  }

  /** Looks up the key of every registered project, so what asks for it later finds it at hand. */
  async warmProjectKeys(): Promise<void> {
    const keys = this.opts.projectKeys;
    if (!keys?.resolve) return;
    const rows = this.db.query<{ path: string }, []>("SELECT path FROM projects").all();
    await Promise.all(rows.map((row) => keys.resolve?.(row.path)));
  }

  /** A `queue` budget of the host or of the card's project is at 100%. */
  private budgetBlocked(projectId: string): boolean {
    if (!this.opts.budgets) return false;
    const { path } = this.getProject(projectId);
    return this.opts.budgets.blocked(this.opts.projectKeys?.known(path) ?? path);
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

  /** A card's notice; one that came from a refusal keeps its reason, which the app translates. */
  private setNotice(id: string, notice: string, why?: unknown): void {
    this.db.query("UPDATE cards SET notice = ? WHERE id = ?").run(notice, id);
    this.setNoticeReason(id, why);
  }

  private setNoticeReason(id: string, why: unknown): void {
    const refusal = refusalOf(why);
    if (!refusal) return;
    this.db
      .query("UPDATE cards SET notice_reason = ?, notice_params = ? WHERE id = ?")
      .run(refusal.reason, JSON.stringify(refusal.params ?? {}), id);
  }

  /** Nothing reached the agent: the run ends and the card waits for the user with the error. */
  private failRun(id: string, runId: string, notice: string, why?: unknown): void {
    this.settleFix(id, { isError: true, error: notice });
    this.workflows.fail(runId, notice, refusalOf(why));
    this.setNotice(id, notice, why);
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
      // A card that waited for blockers starts from the base as it is after they merged.
      const from =
        card.blockedBy.length > 0
          ? await freshBase(project.path, project.baseBranch)
          : { ref: project.baseBranch, notice: null };
      const added = await addWorktree(project.path, card.title, from.ref, limit);
      worktree = added.path;
      const left = added.skipped.length;
      const skipped =
        left === 0
          ? null
          : `${left === 1 ? "1 arquivo do .worktreeinclude não copiado" : `${left} arquivos do .worktreeinclude não copiados`}: passou do limite de ${Math.round((limit / 1024 / 1024) * 100) / 100} MB`;
      const notice = [from.notice, skipped].filter((part) => part !== null).join("; ") || null;
      this.db
        .query(
          "UPDATE cards SET slug = ?, branch = ?, worktree_path = ?, notice = ?, updated_at = ? WHERE id = ?",
        )
        .run(added.slug, added.branch, added.path, notice, now(), id);
      this.changed(id);
    }
    if (this.opts.folderLocks?.isHeld(worktree)) throw folderRemoving(worktree);
    await excludeLocalSettingsAsync(project.path);
    if (project.setupScript) await runSetup(project.setupScript, worktree);
    // The newest run is the active one: older sessions of the card are closed.
    await this.closeRuns(id, runId);
    // A workflow run executes its steps instead of sending the description to one session.
    if (this.workflows.has(runId)) return this.workflows.begin(runId, worktree);
    const prompt = [card.description, project.promptTemplate]
      .filter((part) => part.trim())
      .join("\n\n");
    const { variant } = card;
    const run = this.db
      .query<{ persona: string | null; fix_prompt: string | null }, [string]>(
        "SELECT persona, fix_prompt FROM card_runs WHERE id = ?",
      )
      .get(runId);
    const personaRef = run?.persona ? (JSON.parse(run.persona) as PersonaRef) : undefined;
    const prepared = await (this.opts.preparePersonas ?? withoutPersonas)(personaRef, worktree);
    const { sessionId } = await this.opts.manager.create(
      {
        cwd: worktree,
        prompt: run?.fix_prompt ?? prompt,
        name: card.title,
        ...(variant?.model ? { model: variant.model } : {}),
        ...(variant?.effort ? { effort: variant.effort } : {}),
        ...(personaRef ? { persona: personaRef } : {}),
      },
      { unattended: run?.fix_prompt != null, prepared },
    );
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
      this.db.query("UPDATE cards SET notice = ? WHERE id = ?").run(PENDING_NOTICE, id);
      return;
    }
    const repo = this.getProject(card.projectId).path;
    await this.settle();
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
      this.settleFix(id, { isError: true, error: "stopped before it started" });
      this.place(id, { type: "moved", column: "backlog" });
    } else if (card.workflowRunId) {
      await this.workflows.interrupt(card.workflowRunId);
    } else if (card.sessionId) {
      await this.opts.manager.interrupt(card.sessionId);
    }
    return this.changed(id);
  }

  /** Resolves when every rule accepted so far is in its file. */
  rulesWritten(): Promise<void> {
    return this.ruleWrites;
  }

  /** The project's rules: `permissions.allow` of its root `.claude/settings.local.json`. */
  listRules(projectId: string): Promise<string[]> {
    return readRules(this.getProject(projectId).path);
  }

  /** Removes one rule of the project, keeping the rest of the file; only with `confirm`. */
  async removeRule(projectId: string, rule: string, confirm: boolean): Promise<string[]> {
    if (!confirm) {
      throw new FlightdeckError(
        "invalid_state",
        "confirm removing the rule",
        "rule_remove_confirm",
      );
    }
    return removeRule(this.getProject(projectId).path, rule);
  }

  /**
   * Project rules accepted in a card's session (its run or a workflow step) also go to the
   * repository root's settings.local.json, which every new worktree of the project copies.
   */
  private async applyProjectRules(sessionId: string, updates: PermissionUpdate[]): Promise<void> {
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
      await excludeLocalSettingsAsync(repo);
      await addRules(repo, rules);
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
    if (!card.worktreePath)
      throw new FlightdeckError(
        "invalid_state",
        "the card has no worktree yet",
        "card_no_worktree",
      );
    return cardDiff(card.worktreePath, this.getProject(card.projectId).baseBranch);
  }

  /**
   * Pushes the card's branch to `origin` and opens the PR with the card's title and description;
   * `description` (phase 22) is the text the person confirmed, instead of the card's own.
   */
  async createPr(id: string, options: { description?: string } = {}): Promise<Card> {
    const found = options.description ? (this.opts.scanner?.scan(options.description) ?? []) : [];
    if (found.length > 0) {
      throw new FlightdeckError(
        "bad_request",
        `the description looks like it has a secret (${found.join(", ")}): take it out before opening the PR`,
        "pr_secret",
        { found: found.join(", ") },
      );
    }
    const card = this.getCard(id);
    const project = this.getProject(card.projectId);
    const provider = (this.opts.prProvider ?? prProvider)(project.prProvider);
    if (!provider)
      throw new FlightdeckError(
        "invalid_state",
        "the project has no PR provider",
        "project_no_pr_provider",
      );
    const { worktreePath: cwd, branch } = card;
    if (!cwd || !branch)
      throw new FlightdeckError(
        "invalid_state",
        "the card has no worktree yet",
        "card_no_worktree",
      );
    must(await git(cwd, "push", "-u", "origin", branch), "git push");
    const url = await provider.create({
      cwd,
      base: project.baseBranch,
      head: branch,
      title: card.title,
      // The provider links the PR to the issue and closes it on merge (`Fixes #n`, `AB#id`).
      body:
        options.description ??
        [card.description, card.issueRef ? closingLine(card.issueRef) : null]
          .filter((part) => part?.trim())
          .join("\n\n"),
    });
    this.db
      .query(
        "UPDATE cards SET pr_url = ?, pr_state = 'open', checks_state = NULL, notice = NULL WHERE id = ?",
      )
      .run(url, id);
    this.place(id, { type: "pr", state: "open" });
    this.armPoll();
    if (project.issues?.commentOnPr && card.issueRef) {
      await this.commentOnIssue(id, project.path, card.issueRef, url);
    }
    return this.getCard(id);
  }

  /** The review comments of the card's PR, as last fetched (fetched now when there are none). */
  async prComments(id: string): Promise<PrComment[]> {
    if (!this.getCard(id).prUrl)
      throw new FlightdeckError("invalid_state", "the card has no PR", "card_no_pr");
    return this.prCommentCache.get(id) ?? this.fetchPrComments(id);
  }

  /** Asks the provider; read only, nothing is posted back. */
  private async fetchPrComments(id: string): Promise<PrComment[]> {
    const card = this.getCard(id);
    const project = this.getProject(card.projectId);
    const provider = (this.opts.prProvider ?? prProvider)(project.prProvider);
    if (!provider)
      throw new FlightdeckError(
        "invalid_state",
        "the project has no PR provider",
        "project_no_pr_provider",
      );
    const comments = await provider.comments({ cwd: project.path, url: card.prUrl as string });
    this.prCommentCache.set(id, comments);
    return comments;
  }

  /** Sends the chosen PR comments to the card's session, in the review's format. */
  async sendPrComments(id: string, ids: readonly string[]): Promise<{ sent: number }> {
    const chosen = (await this.prComments(id)).filter((c) => ids.includes(c.id));
    if (chosen.length === 0)
      throw new FlightdeckError("bad_request", "no comment was chosen", "pr_no_comment");
    this.message(id, prMessage(chosen));
    return { sent: chosen.length };
  }

  /** The card's worktree and branch, while no turn of its agent is going on. */
  private idleWorktree(id: string): { card: Card; worktree: string; branch: string } {
    const card = this.getCard(id);
    if (!card.worktreePath || !card.branch) {
      throw new FlightdeckError(
        "invalid_state",
        "the card has no worktree yet",
        "card_no_worktree",
      );
    }
    if (card.queued || (card.sessionStatus !== null && BUSY.has(card.sessionStatus))) {
      throw new FlightdeckError(
        "invalid_state",
        "the card is running: wait for the agent to finish",
        "card_running",
      );
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
    if (!confirm) throw new FlightdeckError("invalid_state", "confirm the merge", "merge_confirm");
    const { card, worktree, branch } = this.idleWorktree(id);
    if (card.prUrl) {
      throw new FlightdeckError(
        "invalid_state",
        "the card has a PR: the PR completes it",
        "card_has_pr",
      );
    }
    const pending = await pendingFiles(worktree);
    if (pending.length > 0) {
      throw new FlightdeckError(
        "invalid_state",
        `the card's worktree has uncommitted changes: ${pending.join(", ")}`,
        "worktree_dirty",
        { files: pending.join(", ") },
      );
    }
    const project = this.getProject(card.projectId);
    const base = project.baseBranch;
    await assertLocalBranch(project.path, base);
    const { ahead } = await aheadBehind(worktree, base);
    if (ahead === 0)
      throw new FlightdeckError("invalid_state", `nothing ahead of ${base}`, "nothing_ahead", {
        base,
      });
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
    await this.settle();
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

  /** A comment with the PR's link on the card's issue; a failure only notices the card. */
  private async commentOnIssue(id: string, cwd: string, ref: string, url: string): Promise<void> {
    try {
      const parsed = parseIssueRef(ref) as NonNullable<ReturnType<typeof parseIssueRef>>;
      await (providerOfRef(ref) as NonNullable<ReturnType<typeof providerOfRef>>).comment(
        cwd,
        parsed.id,
        `PR aberto: ${url}`,
      );
    } catch (error) {
      const notice = `PR aberto, mas não comentou na issue: ${(error as Error).message}`;
      this.db.query("UPDATE cards SET notice = ? WHERE id = ?").run(notice, id);
      this.changed(id);
    }
  }

  /** Manual completion: Concluído (locked) and the same cleanup as a merged PR. */
  async completeCard(id: string, confirm: boolean): Promise<Card> {
    if (!confirm)
      throw new FlightdeckError("invalid_state", "confirm completing the card", "complete_confirm");
    this.place(id, { type: "moved", column: "done" }, "completed");
    await this.finish(id);
    return this.getCard(id);
  }

  /**
   * Throws the card away: sessions closed, worktree removed even with changes, local branch
   * deleted, card off the board. Returns its last state, marked `discarded`.
   */
  async discardCard(id: string, confirm: boolean): Promise<Card> {
    if (!confirm)
      throw new FlightdeckError("invalid_state", "confirm discarding the card", "discard_confirm");
    const card = this.getCard(id);
    // The variants of an arena go with its card.
    for (const variant of this.variantIds(id)) await this.discardCard(variant, true);
    await this.closeRuns(id);
    this.follows.get(id)?.();
    this.follows.delete(id);
    const repo = this.getProject(card.projectId).path;
    if (card.worktreePath) {
      await Promise.all(this.ends.map((end) => end(id)));
      await this.settle();
      must(
        await git(repo, "worktree", "remove", "--force", card.worktreePath),
        "git worktree remove",
      );
    }
    if (card.branch) must(await git(repo, "branch", "-D", card.branch), "git branch -D");
    return this.removeFromBoard(id, "discarded");
  }

  /**
   * Deletes a card that never started (no worktree, no branch, no session, no run). Returns its
   * last state, marked `discarded` like a discarded card, so the app drops it the same way.
   * A card that started has work to clean up and goes through `discardCard`.
   */
  deleteCard(id: string, confirm: boolean): Card {
    if (!confirm)
      throw new FlightdeckError("invalid_state", "confirm deleting the card", "delete_confirm");
    const card = this.getCard(id);
    const ran = this.db.query("SELECT 1 FROM card_runs WHERE card_id = ?").get(id) !== null;
    if (card.worktreePath || card.branch || card.sessionId || ran) {
      throw new FlightdeckError(
        "invalid_state",
        "the card already started: discard it instead of deleting it",
        "card_delete_started",
      );
    }
    return this.removeFromBoard(id, "deleted");
  }

  /** The card leaves the board and the cards it held up are free of it; `discardCard` cleans its worktree first. */
  private removeFromBoard(id: string, verb: "discarded" | "deleted"): Card {
    const last = this.getCard(id);
    this.workflows.forget(id);
    const holdingUp = this.blockingOf(id);
    const heldBy = this.blockersOf(id);
    this.db.query("DELETE FROM card_runs WHERE card_id = ?").run(id);
    forgetDone(this.db, id);
    this.db.query("DELETE FROM cards WHERE id = ?").run(id);
    const gone = { ...last, worktreePath: null, branch: null, discarded: true };
    this.emit(gone);
    // A card that is gone can never be done: the cards it held up are free of it.
    const notice = `Blocker "${last.title}" was ${verb} and no longer blocks this card.`;
    for (const dependent of holdingUp) {
      this.db.query("UPDATE cards SET notice = ? WHERE id = ?").run(notice, dependent);
      this.afterBlockerChange(dependent);
      this.changed(dependent);
    }
    for (const blocker of heldBy) this.changed(blocker);
    return gone;
  }

  /** Calls `listener` after every round of the PR polling. */
  onPrRound(listener: () => void): () => void {
    this.prRoundListeners.add(listener);
    return () => this.prRoundListeners.delete(listener);
  }

  /**
   * The PR polling runs while some card has an open PR, or a merged card waits for its worktree
   * to be removed; with none it owns no timer, and a PR that is opened starts it.
   */
  private armPoll(): void {
    const wanted =
      !this.stopped &&
      this.db
        .query(
          `SELECT 1 FROM cards WHERE pr_state = 'open'
           OR (pr_state = 'merged' AND board_column = 'done' AND worktree_path IS NOT NULL
               AND notice IS NOT NULL AND notice <> ?) LIMIT 1`,
        )
        .get(PENDING_NOTICE) !== null;
    if (wanted && this.pollTimer === null) {
      this.pollTimer = setInterval(() => void this.pollPrs(), this.prPollIntervalMs);
    } else if (!wanted && this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
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
      const failed = (id: string) => (error: unknown) => {
        // After stop() the failure is the shutdown's (a closed database): nothing to record.
        if (this.stopped) return;
        this.setNotice(id, error instanceof Error ? error.message : String(error), error);
        // The card may have been discarded while the provider was answering.
        if (this.db.query("SELECT 1 FROM cards WHERE id = ?").get(id)) this.changed(id);
      };
      for (const { id } of open) await this.pollPr(id).catch(failed(id));
      if (this.stopped) return;
      // Merged, but the worktree removal failed (a busy folder on Windows; its error is the
      // notice): finish again, without asking the provider. Pending changes wait for the user,
      // as in completeCard, and a card started again (notice cleared) is left alone.
      const unfinished = this.db
        .query<{ id: string }, [string]>(
          `SELECT id FROM cards WHERE pr_state = 'merged' AND board_column = 'done'
           AND worktree_path IS NOT NULL AND notice IS NOT NULL AND notice <> ?`,
        )
        .all(PENDING_NOTICE);
      for (const { id } of unfinished) await this.finish(id).catch(failed(id));
      for (const listener of this.prRoundListeners) listener();
    } finally {
      this.polling = false;
      this.armPoll();
    }
  }

  private async pollPr(id: string): Promise<void> {
    const card = this.getCard(id);
    const project = this.getProject(card.projectId);
    const provider = (this.opts.prProvider ?? prProvider)(project.prProvider);
    if (!provider || !card.prUrl) return;
    // From the main repository: a cwd inside the worktree would lock it while it is removed.
    const cwd = project.path;
    const { state, checks, failed } = await provider.status({ cwd, url: card.prUrl });
    if (this.stopped) return;
    this.db
      .query("UPDATE cards SET pr_state = ?, checks_state = ?, notice = NULL WHERE id = ?")
      .run(state, checks, id);
    this.changed(id);
    if (checks === "failing" && card.checksState !== "failing") {
      for (const listener of this.checkWatchers) listener(id, failed ?? []);
    }
    if (state !== card.prState) this.place(id, { type: "pr", state });
    // The comments come in the same round; a failure keeps the last ones, quietly.
    if (state === "open") await this.fetchPrComments(id).catch(() => {});
    if (state === "merged") await this.finish(id);
  }

  get maxParallelRuns(): number {
    return this.limit;
  }

  /** A higher limit starts queued cards right away; a lower one lets running ones finish. */
  async setMaxParallelRuns(value: number): Promise<void> {
    this.limit = value;
    this.pump();
    await this.opts.onSettingsChange?.({ maxParallelRuns: value });
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.unwatchQuota();
    this.unwatchBudgets();
    for (const unfollow of this.follows.values()) unfollow();
    this.follows.clear();
  }

  // -- internals ------------------------------------------------------------

  private place(id: string, event: BoardEvent, via?: DoneVia): void {
    const card = this.getCard(id);
    const next = nextColumn({ column: card.column, locked: card.columnLocked }, event);
    this.db
      .query("UPDATE cards SET board_column = ?, column_locked = ?, updated_at = ? WHERE id = ?")
      .run(next.column, next.locked ? 1 : 0, now(), id);
    // The first time a card is done is the fact the ROI view counts delivered work by.
    if (next.column === "done" && card.column !== "done") {
      const how = via ?? (event.type === "pr" && event.state === "merged" ? "merged" : "moved");
      recordDone(this.db, id, how, now());
    }
    this.changed(id);
  }

  /** Every card of the project that has a worktree, arena variants included. */
  worktreeCards(projectId: string): Card[] {
    return this.db
      .query<{ id: string }, [string]>(
        "SELECT id FROM cards WHERE project_id = ? AND worktree_path IS NOT NULL",
      )
      .all(projectId)
      .map(({ id }) => this.getCard(id));
  }

  /** Whether a card's run is going or waiting: its folder is in use. */
  isActive(cardId: string): boolean {
    return this.running.has(cardId) || this.getCard(cardId).queued;
  }

  /** The card no longer has its worktree (a panel removed it); the watchers hear of it. */
  releaseWorktree(id: string, path: string, clearBranch: boolean): void {
    // Only the worktree that was removed: a card that got another one meanwhile keeps it.
    const done = this.db
      .query(
        `UPDATE cards SET worktree_path = NULL, notice = NULL, updated_at = ?${
          clearBranch ? ", branch = NULL" : ""
        } WHERE id = ? AND worktree_path = ?`,
      )
      .run(new Date().toISOString(), id, path);
    if (done.changes === 0) return;
    this.changed(id);
  }

  /** Tells the watchers about a card whose fields changed outside the board (the board sync's). */
  announce(id: string): void {
    this.changed(id);
  }

  /** Sends the card as it is now to every watcher, and returns it. */
  private changed(id: string): Card {
    const card = this.getCard(id);
    this.emit(card);
    // What a card waits for follows its blockers' columns: the cards it holds up are news too.
    for (const dependent of this.blockingOf(id)) {
      this.afterBlockerChange(dependent);
      this.emit(this.getCard(dependent));
    }
    return card;
  }

  private emit(card: Card): void {
    // A variant is not on the board: what changed in it is news of the arena's card.
    const shown = card.arenaOf ? this.getCard(card.arenaOf) : card;
    for (const watcher of this.watchers) {
      try {
        watcher(shown);
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
    if (event.type === "turn.result") {
      this.place(cardId, { type: "turn", isError: event.isError });
      this.settleFix(cardId, {
        costUsd: event.costUsd ?? 0,
        isError: event.isError,
        error: event.isError ? event.subtype : null,
      });
    }
    if (event.type === "session.error") {
      this.settleFix(cardId, { isError: true, error: event.message });
    }
    if (event.type === "session.status" && FREES_SLOT.has(event.status)) this.release(cardId);
  }
}
