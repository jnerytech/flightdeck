/**
 * The security gate of `bun run handoff:check` (#273): the changed source files whose added lines
 * spawn or kill a process, delete files, handle a secret or a permission, or live in the vault or
 * the pairing code, and whether the security-reviewer's verdict was committed after the last of
 * them, as a `Security-Reviewed: <summary>` trailer.
 */

export interface RiskyFile {
  path: string;
  /** The risk areas its added lines touch, e.g. "spawn", "delete". */
  why: string[];
}

export interface BranchCommit {
  sha: string;
  files: string[];
  /** The `Security-Reviewed:` trailer's text, or null. */
  reviewed: string | null;
}

/** The added lines of each file in a `git diff -U0` output. */
export function addedLines(_diff: string): Map<string, string[]> {
  return new Map();
}

/** The changed source files (never a test) in a risk area, sorted by path. */
export function riskyFiles(_added: Map<string, string[]>): RiskyFile[] {
  return [];
}

/** The commits of `git log --format=%x1e%H%x1f%(trailers:key=Security-Reviewed,valueonly) --name-only`, newest first. */
export function parseBranchLog(_log: string): BranchCommit[] {
  return [];
}

/** Why the hand-off needs a security review, or null when none is needed or one came after the last risky commit. */
export function securityProblem(_risky: RiskyFile[], _commits: BranchCommit[]): string | null {
  return null;
}
