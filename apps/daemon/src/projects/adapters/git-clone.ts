/**
 * The real `git` as a process for the projects domain (#1612): the one place a clone is run from.
 * `cloneRepo` builds the arguments (the url after `--`, the path under an allowed root); this runs them.
 */

/** How long the text of stderr is waited for once git itself has ended. */
const STDERR_GRACE_MS = 2_000;

/** A `git` runner: no prompt for a password, and a command still running after `timeoutMs` is stopped. */
export const gitRunner =
  (timeoutMs: number) =>
  async (args: string[]): Promise<{ code: number; stderr: string }> => {
    // git-arg: the clone runner: the url comes after `--` and the path is under an allowed root
    const proc = Bun.spawn(["git", ...args], {
      stdout: "ignore",
      stderr: "pipe",
      stdin: "ignore",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" },
    });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    try {
      const stderr = new Response(proc.stderr).text();
      const code = await proc.exited;
      // A child that outlives a killed git can hold the pipe open: its text is not worth the wait.
      return {
        code,
        stderr: await Promise.race([stderr, Bun.sleep(STDERR_GRACE_MS).then(() => "")]),
      };
    } finally {
      clearTimeout(timer);
    }
  };
