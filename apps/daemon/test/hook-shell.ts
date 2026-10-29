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

/** Async: a receptor in the same process must keep answering while the hook runs. */
export async function runHookCommand(
  command: string,
  input: string,
  env: Record<string, string | undefined> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(claudeHookShell(command), {
    env: { ...process.env, ...env },
    stdin: new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}
