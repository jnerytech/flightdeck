/**
 * The program of an action as a process (#1612): the one place the actions domain starts one. The
 * runner builds the argument list (never a shell line), the working folder and the cleaned
 * environment from the declared action; this starts them.
 */

/** How a program starts: the runner's port, which tests replace with a fake. */
export type SpawnProgram = typeof Bun.spawn;

/** Starts `argv` as it is given: no shell, and the options (cwd, env, stdio) exactly as the runner built them. */
export const spawnProgram: SpawnProgram = ((
  ...args: Parameters<SpawnProgram>
): ReturnType<SpawnProgram> => Bun.spawn(...args)) as SpawnProgram;
