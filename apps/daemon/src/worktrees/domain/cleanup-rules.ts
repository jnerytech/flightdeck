/**
 * The cleanup rules of the worktrees domain (#1601): how git's listing reads, which worktrees are
 * Flightdeck's, what a removal would lose and what blocks it. No I/O of its own: git's answers and
 * the clock come in as arguments.
 */
import { resolve } from "node:path";
import type { BoardColumn, PrState, WorktreeBlocker } from "@flightdeck/protocol";
import type { CommandResult } from "../../kernel/index.ts";
import { credential } from "../../permissions/index.ts";

export interface WorktreeCard {
  id: string;
  title: string;
  column: BoardColumn;
  worktreePath: string | null;
  updatedAt: string;
  prState: PrState | null;
}

export const DAY_MS = 86_400_000;
/** A worktree must have been quiet this long to be suggested. */
export const IDLE_DAYS = 7;

/** The worktrees `git worktree list --porcelain` names: path and branch (short name), in order. */
export function parseList(out: string): Array<{ path: string; branch: string | null }> {
  return out
    .split(/\n\n+/)
    .map((block) => {
      const lines = block.split("\n");
      const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
      const ref = lines.find((l) => l.startsWith("branch "))?.slice("branch ".length);
      // Git writes `C:/x/y` on Windows: the path is the system's own spelling from here on.
      return path
        ? { path: resolve(path), branch: ref ? ref.replace(/^refs\/heads\//, "") : null }
        : null;
    })
    .filter((entry): entry is { path: string; branch: string | null } => entry !== null);
}

/** The branches Flightdeck makes; a worktree on any other branch is somebody else's work. */
const OWN_PREFIX = "fd/";

/**
 * What a build or an install recreates, and only as a folder at the root of the worktree: losing
 * these costs time, not work. The same name deeper is somebody's data (`data/out/results.db`).
 */
export const REBUILDABLE = new Set([
  "node_modules",
  "dist",
  "build",
  "target",
  "coverage",
  ".cache",
  ".next",
  "out",
]);

/**
 * A name that looks like it holds a credential: such a file is never a loss to shrug at. The names
 * the classifier knows come from its one list (`credential()`); this adds the ones a name only
 * hints at.
 */
const CREDENTIAL_HINT = /credential|secret|token|passw(?:or)?d|api[_-]?key/i;
export const credentialName = (part: string) => credential(part) || CREDENTIAL_HINT.test(part);

/** The size an ignored file may have to be compared with the project's copy of it. */
export const COMPARE_LIMIT = 1024 * 1024;

const COUNT = /^\d+$/;
const SHA = /^[0-9a-f]{40,64}$/;

/** The trimmed output of a git answer that succeeded; null when it failed or was not asked. */
export const okOut = (answer: CommandResult | null): string | null =>
  answer?.code === 0 ? answer.stdout.trim() : null;

/** Whether git printed a plain number (a count, a unix time). */
export const isCount = (text: string | null): text is string => text !== null && COUNT.test(text);

/**
 * Whether `git ls-files -v -z` shows a tracked file that status hides: `assume-unchanged` (a
 * lowercase tag) or `skip-worktree` (`S`).
 */
export function hidesChanges(listing: CommandResult): boolean {
  return (
    listing.code === 0 &&
    listing.stdout.split("\0").some((entry) => entry !== "" && /^[a-z]|^S/.test(entry))
  );
}

/** Any answer of git that is not a plain number (or a failed command) is "git cannot say". */
export function cannotTell(facts: {
  baseUsable: boolean;
  count: string | null;
  listingFailed: boolean;
  stamp: string | null;
  branch: string | null;
  tipSha: string | null;
}): boolean {
  return (
    (facts.baseUsable && !isCount(facts.count)) ||
    facts.listingFailed ||
    !isCount(facts.stamp) ||
    (facts.branch !== null && !SHA.test(facts.tipSha ?? ""))
  );
}

/** What runs in a worktree folder: a live session, a process of the card's run, or nothing. */
export type FolderUse = "live_session" | "running" | null;

/** What stops a removal, in the order the app shows it. */
export function blockersOf(facts: {
  busy: FolderUse;
  dirty: boolean;
  hidden: boolean;
  ignoredFiles: boolean;
  unpushed: number;
  baseUsable: boolean;
  unknownState: boolean;
  branch: string | null;
}): WorktreeBlocker[] {
  const flags: Array<[boolean, WorktreeBlocker]> = [
    [facts.dirty, "dirty"],
    [facts.hidden, "hidden_changes"],
    [facts.ignoredFiles, "ignored_files"],
    [facts.unpushed > 0, "unpushed"],
    [!facts.baseUsable, "unknown_base"],
    [facts.unknownState, "unknown_state"],
    [!facts.branch?.startsWith(OWN_PREFIX), "other_branch"],
  ];
  return [
    ...(facts.busy ? [facts.busy] : []),
    ...flags.filter(([on]) => on).map(([, blocker]) => blocker),
  ];
}

/** The latest of the last commit, the folder's own mtime and the card's last change. */
export function lastActivityMs(stamp: string | null, mtimeMs: number, card?: WorktreeCard): number {
  const commitMs = isCount(stamp) ? Number(stamp) * 1000 : 0;
  return Math.max(commitMs, mtimeMs, card ? Date.parse(card.updatedAt) || 0 : 0);
}

/** The card's fields an item shows; null where the worktree has no card. */
export function cardFields(card?: WorktreeCard) {
  return {
    cardId: card?.id ?? null,
    cardTitle: card?.title ?? null,
    column: card?.column ?? null,
    prState: card?.prState ?? null,
  };
}

/** Without a card, or with its work done or merged, nothing is left to lose in the folder. */
export const finishedCard = (card?: WorktreeCard): boolean =>
  !card || card.column === "done" || card.prState === "merged";
