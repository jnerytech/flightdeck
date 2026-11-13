/** The `claude plugin` command as a process (#1612): the one place the plugin domain launches the claude CLI from. */

/** Runs `<executable> plugin <args>` with the daemon's environment; settles when it ends or `timeoutMs` passes. */
export async function runClaudePlugin(
  executable: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([executable, "plugin", ...args], {
    env: process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}
