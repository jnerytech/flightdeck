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
export function scrubGitEnv(env: Record<string, string | undefined> = process.env): string[] {
  const removed: string[] = [];
  for (const name of GIT_ENV_VARS) {
    if (env[name] === undefined) continue;
    delete env[name];
    removed.push(name);
  }
  return removed;
}

type SpawnOptions = { env?: Record<string, string | undefined> } & Record<string, unknown>;

/** The arguments of a Bun spawn call with `env` filled in when the caller gave none. */
function withEnv(args: unknown[], env: Record<string, string | undefined>): unknown[] {
  const [first, second, ...rest] = args;
  if (Array.isArray(first)) {
    const options = (second ?? {}) as SpawnOptions;
    return [first, options.env === undefined ? { ...options, env } : options, ...rest];
  }
  const options = (first ?? {}) as SpawnOptions;
  return [options.env === undefined ? { ...options, env } : options, second, ...rest];
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
  const removed = scrubGitEnv();
  const clean = { ...process.env };
  const spawn = Bun.spawn.bind(Bun);
  const spawnSync = Bun.spawnSync.bind(Bun);
  Object.assign(Bun, {
    spawn: (...args: unknown[]) => (spawn as (...a: unknown[]) => unknown)(...withEnv(args, clean)),
    spawnSync: (...args: unknown[]) =>
      (spawnSync as (...a: unknown[]) => unknown)(...withEnv(args, clean)),
  });
  return { removed };
}
