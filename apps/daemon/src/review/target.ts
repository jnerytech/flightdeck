/**
 * What a review target is and what reading its changes returns (#1611): a leaf, so the session
 * commit and PR import the reader they need without importing `changes.ts`, which imports them.
 */

import type { DiffFile } from "@flightdeck/protocol";
import type { Rev } from "../board/ref-arg.ts";

/** What a target (`session:<claudeSessionId>` or `card:<id>`) points at. */
export interface ResolvedTarget {
  target: string;
  /** The repository's top level (the worktree, for a card). */
  root: string;
  /** The card's base branch; `null` for a session, whose diff is against `HEAD`. */
  base: Rev | null;
  cardId: string | null;
  claudeSessionId: string | null;
  /** The card's branch: its position is read from it, never from a `HEAD` that a rebase detaches. */
  branch?: string;
}

export interface ChangesResult {
  target: string;
  root: string;
  base: string | null;
  files: DiffFile[];
  /** A card's commits ahead of and behind its base; `null` for a session. */
  position: { ahead: number; behind: number } | null;
  /** The commit hooks a commit of this checkout runs (#1133); only against `HEAD`. */
  hooks?: string[];
  /** Where a PR's push would go, with no password (#1133); only against `HEAD`. */
  remote?: string;
}

/** The part of `Changes` the session commit and PR read: a target resolved, and its changes. */
export interface ChangesReader {
  resolve(target: string, opts?: { terminal?: boolean }): Promise<ResolvedTarget>;
  get(target: string): Promise<ChangesResult>;
}
