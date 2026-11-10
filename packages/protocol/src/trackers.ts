// Work trackers: GitHub and Azure Boards seen through their CLIs and APIs (issues, sign-in, repositories, alerts) and the sync of a board with an external one (issue #1600: moved from index.ts).
import { z } from "zod";
import type { Card, Issue } from "./board.ts";
import { BoardColumn } from "./board-contracts.ts";
import { cmd } from "./command.ts";

/** Phase 38: where a project's board sync stands. `linked: false` carries nothing else. */
export interface BoardSyncStatus {
  linked: boolean;
  provider?: string;
  boardId?: string;
  boardTitle?: string;
  columnMap?: Partial<Record<string, BoardColumn>>;
  /** Local moves are sent to the board. */
  push?: boolean;
  lastSyncedAt?: string | null;
  lastError?: string | null;
  pausedUntil?: string | null;
  /** The board has more items than one pull reads. */
  truncated?: boolean;
  /** The board's Status options, for the map editor. */
  statusOptions?: string[];
}

/** One board of the external provider. */
export interface BoardSyncBoard {
  id: string;
  title: string;
  owner: string;
  number: number;
  url: string;
}

/** What one sync did. */
export interface BoardSyncReport {
  created: number;
  moved: number;
  updated: number;
  conflicts: number;
  unmapped: number;
  gone: number;
  skipped: number;
  pushed: number;
  redacted: number;
  truncated: boolean;
  notModified: boolean;
}

/** One line of a card's sync log: a conflict, a skipped move, a push that failed. */
export interface BoardSyncLogEntry {
  at: string;
  kind: string;
  winner: "local" | "external" | null;
  lostValue: string | null;
  lostAt: string | null;
  keptValue: string | null;
  keptAt: string | null;
  detail: string | null;
}

/** Phase 37: whether the host's `gh` is signed in to GitHub. Never a token. */
export interface GithubStatusResult {
  installed: boolean;
  loggedIn: boolean;
  login: string | null;
  scopes: string[];
  /** Where `gh` keeps the login. */
  source: "keyring" | "file" | "env" | null;
}

/** The device flow's one-time code and the page where it is typed. */
export interface GithubLoginResult {
  code: string;
  url: string;
}

export interface GithubRepoItem {
  /** `owner/name`. */
  name: string;
  description: string;
  private: boolean;
  url: string;
  updatedAt: string;
}

export interface GithubStartResult {
  projectId: string;
  path: string;
  cardId?: string;
  sessionId?: string;
  /** The folder was already a clone of the repo. */
  reused: boolean;
}

/**
 * Issue #79: an open alert of the project's repository, read by the host with `gh` (code scanning
 * or Dependabot). `text` is what goes into a workflow's `alert` input: the alert's own words, which
 * come from a scanner or an advisory and are data, never instructions.
 */
export const RepoAlert = z.object({
  /** `<kind>:<number>`, unique in the list. */
  id: z.string(),
  kind: z.enum(["code-scanning", "dependabot"]),
  number: z.number().int(),
  severity: z.enum(["critical", "high", "medium", "low", "unknown"]),
  title: z.string(),
  /** `path:line` for code scanning, the manifest for Dependabot. */
  location: z.string().nullable(),
  /** The alert's page on GitHub; empty when it was not an https link. */
  url: z.string(),
  text: z.string(),
});
export type RepoAlert = z.infer<typeof RepoAlert>;

/** Why a source of alerts could not be read, said without `gh`'s own text. */
export const AlertsUnavailable = z.object({
  kind: z.enum(["code-scanning", "dependabot"]),
  reason: z.enum(["gh_missing", "not_signed_in", "unavailable", "failed"]),
});
export type AlertsUnavailable = z.infer<typeof AlertsUnavailable>;

/** The trackers commands; index.ts spreads them into `Command`. */
export const trackersCommands = [
  /** Phase 13: the project's issues (GitHub or Azure Boards) and cards made from them. */
  cmd("issues.list", z.object({ projectId: z.string(), query: z.string().min(1).optional() })),
  cmd("issues.get", z.object({ projectId: z.string(), id: z.string().min(1) })),
  cmd("issues.createCard", z.object({ projectId: z.string(), issueRef: z.string().min(1) })),
  /** Issue #79: the open code-scanning and Dependabot alerts of the project's repository, read-only. */
  cmd("alert.list", z.object({ projectId: z.string() })),
  /** Phase 37: the host's gh login (device flow), the person's repos and issues, and start from them. */
  cmd("github.status", z.object({}).strict()),
  cmd("github.login.start", z.object({}).strict()),
  cmd("github.login.cancel", z.object({}).strict()),
  cmd("github.logout", z.object({}).strict()),
  cmd("github.repos", z.object({ query: z.string().max(100).optional() }).strict()),
  cmd("github.issues", z.object({ repo: z.string().min(1).max(200) }).strict()),
  cmd(
    "github.start",
    z
      .object({
        repo: z.string().min(1).max(200),
        issue: z.string().min(1).max(20).optional(),
        root: z.string().min(1),
        mode: z.enum(["card", "session"]),
      })
      .strict(),
  ),
  /** Phase 38: board sync with an external board (GitHub Projects first). */
  cmd("boardsync.boards", z.object({}).strict()),
  cmd(
    "boardsync.link",
    z
      .object({
        projectId: z.string().min(1),
        boardId: z.string().min(1).max(200),
        columnMap: z.record(z.string().min(1).max(200), BoardColumn).optional(),
      })
      .strict(),
  ),
  cmd("boardsync.unlink", z.object({ projectId: z.string().min(1) }).strict()),
  cmd(
    "boardsync.setMap",
    z
      .object({
        projectId: z.string().min(1),
        columnMap: z.record(z.string().min(1).max(200), BoardColumn),
      })
      .strict(),
  ),
  cmd(
    "boardsync.setPush",
    z.object({ projectId: z.string().min(1), push: z.boolean(), confirm: z.boolean() }).strict(),
  ),
  cmd("boardsync.status", z.object({ projectId: z.string().min(1) }).strict()),
  cmd("boardsync.syncNow", z.object({ projectId: z.string().min(1) }).strict()),
  cmd("boardsync.log", z.object({ cardId: z.string().min(1) }).strict()),
] as const;

/** The `data` of each trackers command's ack; `CommandResults` extends it. */
export interface TrackersResults {
  "issues.list": { issues: Issue[] };
  "issues.get": Issue;
  "issues.createCard": Card;
  "alert.list": { alerts: RepoAlert[]; unavailable: AlertsUnavailable[] };
  "boardsync.boards": { boards: BoardSyncBoard[] };
  "boardsync.link": BoardSyncStatus;
  "boardsync.unlink": undefined;
  "boardsync.setMap": BoardSyncStatus;
  "boardsync.setPush": BoardSyncStatus;
  "boardsync.status": BoardSyncStatus;
  "boardsync.syncNow": { status: BoardSyncStatus; report: BoardSyncReport };
  "boardsync.log": { entries: BoardSyncLogEntry[] };
  "github.status": GithubStatusResult;
  "github.login.start": GithubLoginResult;
  "github.login.cancel": undefined;
  "github.logout": undefined;
  "github.repos": { repos: GithubRepoItem[] };
  "github.issues": { issues: Issue[] };
  "github.start": GithubStartResult;
}
