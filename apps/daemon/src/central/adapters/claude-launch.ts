/**
 * The real `claude` as a process in the user's terminal (#1612): the one place the central launches
 * it from. The wrapper builds the command line and the environment; this runs them.
 */

/** Runs `command` with stdio inherited and `env` as its environment; resolves to its exit code. */
export async function launchClaude(
  command: string[],
  env: Record<string, string | undefined>,
): Promise<number> {
  const proc = Bun.spawn(command, { env, stdio: ["inherit", "inherit", "inherit"] });
  return await proc.exited;
}
