import { FlightdeckError, runCommand, shellCommand } from "../kernel/index.ts";

/**
 * Runs the project's setup script in the worktree. It is the only shell command Flightdeck runs
 * on its own, and only exists when the user registered one.
 */
export async function runSetup(script: string, cwd: string): Promise<void> {
  const result = await runCommand(shellCommand(script), cwd);
  if (result.code === 0) return;
  const output = (result.stderr.trim() || result.stdout.trim()).slice(-2000);
  throw new FlightdeckError(
    "invalid_state",
    `setup script failed (exit ${result.code}): ${output}`,
    "setup_failed",
    { code: result.code, output },
  );
}
