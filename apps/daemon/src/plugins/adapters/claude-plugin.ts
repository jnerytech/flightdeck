/** The `claude plugin` command as a process (#1612): the one place the plugin domain launches the claude CLI from. */

import { whichOnPath } from "../../kernel/index.ts";
import { invalid } from "../domain/plugin-json.ts";
import type { PluginCli } from "../ports.ts";

/** Runs `<executable> plugin <args>` with the daemon's environment; settles when it ends or `timeoutMs` passes. */
async function runClaudePlugin(
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

/** The CLI found on PATH (`claude plugin ...`), with the environment of the daemon. */
export function claudeCli(
  options: { timeoutMs?: number; executable?: () => string | null } = {},
): PluginCli {
  return {
    run: async (args) => {
      const executable = (options.executable ?? (() => whichOnPath("claude")))();
      if (!executable) throw invalid("claude was not found on the PATH", "claude_not_found");
      return runClaudePlugin(executable, args, options.timeoutMs ?? 120_000);
    },
  };
}
