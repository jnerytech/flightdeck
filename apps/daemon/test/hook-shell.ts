/**
 * Runs a command hook the way Claude Code does: through Git Bash on Windows
 * (`CLAUDE_CODE_GIT_BASH_PATH`, else `bash` on PATH) and `sh -c` elsewhere. Bash reads `\` as an
 * escape, so a Windows path written with backslashes does not survive it.
 */
import { whichOnPath } from "../src/which.ts";

export function claudeHookShell(command: string, platform = process.platform): string[] {
  if (platform !== "win32") return ["sh", "-c", command];
  const bash = process.env.CLAUDE_CODE_GIT_BASH_PATH ?? whichOnPath("bash") ?? "bash";
  return [bash, "-c", command];
}

export function runHookCommand(
  command: string,
  input: string,
  env: Record<string, string | undefined> = {},
): { code: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(claudeHookShell(command), {
    env: { ...process.env, ...env },
    stdin: new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}
