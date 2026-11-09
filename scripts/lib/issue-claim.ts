/**
 * Issue #1410: a session claims an issue before it starts, and a claim by another session is
 * refused. Every issue's assignee is the same account, so the owner lives in a hidden marker of the
 * issue's comments, written by `issue-note.sh` and by `bun run claim`:
 * `<!-- flightdeck-owner: <session> status: <progress|reassign|ready|done|todo> -->`.
 */
import type { GhResult } from "./ci-branch.ts";

export type ClaimStatus = "progress" | "reassign" | "ready" | "done" | "todo";

/** One marker read back from a comment, in the order GitHub lists them. */
export interface OwnerMark {
  owner: string;
  status: ClaimStatus;
  at: string;
}

export interface ClaimDeps {
  /** Runs `gh <args>` in the repository. */
  gh(args: string[]): Promise<GhResult>;
  log(line: string): void;
  /** The session from FLIGHTDECK_SESSION, when set. */
  session?: string;
  /** FLIGHTDECK_COORDINATOR=1: the only session that may reassign. */
  coordinator: boolean;
}

/** The marker line for a comment. */
export function ownerMark(_owner: string, _status: ClaimStatus): string {
  return "";
}

/** The markers of an issue's comments, oldest first; a comment without one gives none. */
export function marksOf(_comments: Array<{ body: string; createdAt: string }>): OwnerMark[] {
  return [];
}

/** Who owns the issue after these marks, or null when it is free. */
export function currentOwner(_marks: OwnerMark[]): string | null {
  return null;
}

/** `claim <n> [--by <session>] [--reassign]`; the exit code. */
export async function claimIssue(_args: string[], _deps: ClaimDeps): Promise<number> {
  return 0;
}
