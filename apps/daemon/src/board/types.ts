import type { Database } from "bun:sqlite";
import type {
  AutoApproveSettings,
  BoardColumn,
  ChecksState,
  ColumnContract,
  IssuesConfig,
  PersonaSubagentsMode,
  PrMergeable,
  PrProviderKind,
  PrReview,
  PrState,
  UnblockWhen,
} from "@flightdeck/protocol";
import type { Prepare } from "../personas/index.ts";
import type { PrProvider } from "../pr/index.ts";
import type { Quota } from "../quota/index.ts";
import type { SessionManager } from "../sessions/index.ts";
import type { SecretScanner } from "../snippets/model.ts";
import type { BoundedCheckRunner, CheckRunner } from "../workflows/check-runner.ts";

// The board's shapes are the protocol's: what the daemon stores is what goes on the wire.
export type {
  BoardColumn,
  Card,
  CardDiff,
  CardRun,
  DiffFile,
  DiffHunk,
  DiffLine,
  MayConflict,
  Project,
  PrProviderKind,
  PrState,
} from "@flightdeck/protocol";

export interface NewProject {
  path: string;
  name?: string;
  baseBranch?: string;
  prProvider?: PrProviderKind;
  setupScript?: string | null;
  promptTemplate?: string;
  /** Phase 13: fields left out keep their value (or the default). */
  autoApprove?: Partial<AutoApproveSettings>;
  /** Phase 13: `null` removes the issue integration. */
  issues?: IssuesConfig | null;
}

export type ProjectPatch = Partial<Omit<NewProject, "path">> & {
  /** The default persona by column (phase 20); `null` removes a column's. */
  personaByColumn?: Partial<Record<BoardColumn, string | null>>;
  /** What each column asks of a card (issue #78); `null` gives a column back to the default. */
  contractByColumn?: Partial<Record<BoardColumn, ColumnContract | null>>;
  /** Which personas the project offers as subagents (phase 20). */
  personaSubagents?: PersonaSubagentsMode;
  /** Phase 36: the hours a done card is worth without an estimate; `null` removes it. */
  defaultHours?: number | null;
  /** Phase 36: which optional value signals are on; a field left out keeps its value. */
  roiSignals?: { commits?: boolean; issues?: boolean };
};

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
  /** Issue #1343: while the host's memory is at or above `resources.pauseAt`, new cards wait. */
  memory?: { blocked(): unknown; watch(listener: () => void): () => void };
  /** Issue #1404: while the person has paused new runs on the host, new cards wait. */
  pause?: { blocked(): unknown; watch(listener: () => void): () => void };
  /** Issue #1361: the check loop (a project's checks after a card's turn); off when absent. */
  checkLoop?: {
    settings(projectId: string): {
      checks: string[];
      checkTimeoutMin: number;
      checkRounds: number;
      checkEnv: string[];
    };
    isTrusted(path: string): boolean;
    runner: Pick<BoundedCheckRunner, "run">;
  };
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
  /**
   * Issue #78: the folder a card's spec template may be read from (the trusted checkout of the
   * worktree's project), or null when the project is not trusted: its template would reach the
   * agent before the person trusted it. `own` says `cwd` is the project's own folder, not a worktree
   * (a card with no worktree).
   */
  specTemplateRoot?: (cwd: string, own?: true) => Promise<string | null>;
  /** Lines for the daemon's log (no card content goes there). */
  log?: (line: string) => void;
  /** Settles when no background git work (phase 12's snapshots) runs in a worktree to remove. */
  idle?: () => Promise<void>;
  /** Issue #79: keeps automatic approval off a card made from an agent's findings. */
  suspendApproval?: (cardId: string, reason: string) => void;
}

export interface ProjectRow {
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
  contract_by_column: string | null;
  persona_subagents: PersonaSubagentsMode | null;
  default_hours: number | null;
  roi_commits: number;
  roi_issues: number;
}

export interface CardRow {
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
  pr_mergeable: PrMergeable | null;
  pr_review: PrReview | null;
  pr_opened_at: string | null;
  notice: string | null;
  notice_reason: string | null;
  notice_params: string | null;
  issue_ref: string | null;
  issue_external: number;
  external_url: string | null;
  external_gone: number;
  estimate_hours: number | null;
  validation_note: string | null;
  spec_path: string | null;
  pinned_docs: string | null;
  start_workflow: string | null;
  start_persona: string | null;
  spec_checked_path: string | null;
  spec_found: number;
  spec_heading: string | null;
  spec_draft: number;
  arena_of: string | null;
  variant: string | null;
  unblock_when: UnblockWhen;
  auto_start: string | null;
  unblocked_at: string | null;
  waiting: number;
  check_loop: number;
  check_rounds: number | null;
  check_loop_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunRow {
  id: string;
  card_id: string;
  session_id: string | null;
  queued_at: string;
  started_at: string | null;
  ended_at: string | null;
}
