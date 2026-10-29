import type { SessionStatus } from "@flightdeck/protocol";

export type PrProviderKind = "github" | "azure-devops" | "none";

export interface Project {
  id: string;
  path: string;
  name: string;
  baseBranch: string;
  prProvider: PrProviderKind;
  /** The only shell command Flightdeck runs on its own, and only when registered. */
  setupScript: string | null;
  /** Appended to the prompt of every card. */
  promptTemplate: string;
}

export interface NewProject {
  path: string;
  name?: string;
  baseBranch?: string;
  prProvider?: PrProviderKind;
  setupScript?: string | null;
  promptTemplate?: string;
}

export type ProjectPatch = Partial<Omit<NewProject, "path">>;

export type BoardColumn = "backlog" | "in_progress" | "waiting" | "review" | "done";

export type PrState = "open" | "merged" | "closed";
export type ChecksState = "pending" | "passing" | "failing";

export interface CardRun {
  /** `null` while queued or preparing the worktree. */
  sessionId: string | null;
  queuedAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface Card {
  id: string;
  projectId: string;
  title: string;
  description: string;
  column: BoardColumn;
  /** Moved by hand to Backlog or Done: events leave it there until the next start. */
  columnLocked: boolean;
  position: number;
  slug: string | null;
  branch: string | null;
  worktreePath: string | null;
  prUrl: string | null;
  prState: PrState | null;
  checksState: ChecksState | null;
  /** Started and waiting for a free slot. */
  queued: boolean;
  /** Session of the active (latest) run. */
  sessionId: string | null;
  sessionStatus: SessionStatus | null;
  /** Last problem worth showing on the card (failed setup, worktree kept on completion). */
  notice: string | null;
  /** Set only on the last update of a discarded card, which leaves the board. */
  discarded: boolean;
  runs: CardRun[];
  createdAt: string;
  updatedAt: string;
}
