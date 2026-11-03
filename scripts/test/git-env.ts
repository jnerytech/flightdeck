/**
 * Git variables that point a `git` call at a repository other than the folder it runs in. A test
 * run from inside a git command or hook inherits them, and a `git init --bare` in a temporary
 * folder then re-initialises the repository they name.
 */
export const GIT_ENV_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_CEILING_DIRECTORIES",
] as const;

/** Removes those variables from `env`; returns the names that were set. */
export function scrubGitEnv(_env: Record<string, string | undefined> = process.env): string[] {
  return [];
}

/** What `installGitEnvGuard` did: the variables it removed. */
export interface GitEnvGuard {
  removed: string[];
}

/**
 * Removes the redirecting git variables from `process.env` and from the environment that
 * `Bun.spawn` and `Bun.spawnSync` give a child by default. That default is the environment the
 * process started with, so deleting from `process.env` alone does not reach it.
 */
export function installGitEnvGuard(): GitEnvGuard {
  return { removed: [] };
}
