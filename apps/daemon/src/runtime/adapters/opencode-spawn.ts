/**
 * The `opencode` program and the `taskkill` that ends it, as processes (#1612): the one place the
 * runtime launches them from. The callers choose the command line, the folder and the environment;
 * this runs them.
 */

/** Runs `argv` and lets it go: no input, no output kept, nothing waited for (the Windows `taskkill`). */
export function spawnQuiet(argv: string[]): void {
  Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
}

/**
 * Starts `argv` as an OpenCode child that is read from its output: no input, errors dropped,
 * its own process group on POSIX so that ending it reaches what it started.
 */
export function spawnGrouped(argv: string[], opts: { cwd: string; env: Record<string, string> }) {
  return Bun.spawn(argv, {
    cwd: opts.cwd,
    env: opts.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    detached: process.platform !== "win32",
  });
}
