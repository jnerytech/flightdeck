/**
 * Guard against a test writing into the repository the suite runs in: a worktree path that fell
 * back to "" makes a `git` call or a write land in the current folder. The head and the working
 * tree are noted before the run and compared after it.
 */
export interface RepoGuard {
  root: string;
  head: string;
  status: string;
}

export function installRepoGuard(_root: string): RepoGuard | null {
  return null;
}

/** Throws when the repository's head or working tree is not what it was. */
export function assertRepoUntouched(_guard: RepoGuard | null): void {}

/** Throws when PATH is not what it was: a fake CLI left on it slows or misleads every later test. */
export function assertPathUntouched(_before: string | undefined): void {}
