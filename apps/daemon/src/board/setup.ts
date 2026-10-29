import { FlightdeckError } from "../errors.ts";
import { runCommand } from "./command.ts";

/** `cmd.exe /d /s /c` on Windows (ComSpec), `sh -c` elsewhere. */
export function shellCommand(script: string, platform = process.platform): string[] {
  if (platform === "win32") return [process.env.ComSpec ?? "cmd.exe", "/d", "/s", "/c", script];
  return ["sh", "-c", script];
}

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
    `preparação falhou (código ${result.code}): ${output}`,
  );
}
