import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "../board/command.ts";
import { shellCommand } from "../board/setup.ts";
import { whichOnPath } from "../which.ts";
import { MAX_VALUE } from "./interpolate.ts";

/** How long a check may run before it is killed, unless the caller gives another limit. */
export const DEFAULT_CHECK_TIMEOUT_MS = 10 * 60_000;

export interface CheckResult {
  exitCode: number;
  /** The last 8 KB of stdout followed by stderr. */
  output: string;
  /** The command ran out of time and was killed. */
  timedOut?: boolean;
}

/** Runs the `check` commands of trusted workflows. */
export interface CheckRunner {
  run(command: string, cwd: string, timeoutMs?: number): Promise<CheckResult>;
}

/** Set by the tests and smokes (scripts/test/check-guard.ts). */
export const CHECK_GUARD_ENV = "FLIGHTDECK_CHECK_GUARD";

/**
 * Under the test guard, only commands whose executable (resolved on the current PATH) lives in
 * a directory the guard allows reach the shell; any other is recorded and refused.
 */
function allowedByGuard(command: string, guard: string): boolean {
  const executable = whichOnPath(command.trim().split(/\s+/)[0] ?? "") ?? "";
  const allowed = readFileSync(join(guard, "allowed"), "utf8").split(/\r?\n/).filter(Boolean);
  if (executable && allowed.some((dir) => executable.startsWith(dir))) return true;
  appendFileSync(join(guard, "refused.log"), `${command}\n`);
  return false;
}

/**
 * The real executor: the same shell as the setup script (`cmd.exe /d /s /c` on Windows, `sh -c`
 * elsewhere) in the card's worktree. It only gets commands the engine checked against the
 * trusted workflow.
 */
export function shellCheckRunner(
  env: Record<string, string | undefined> = process.env,
): CheckRunner {
  return {
    async run(command, cwd, timeoutMs = DEFAULT_CHECK_TIMEOUT_MS) {
      const guard = env[CHECK_GUARD_ENV];
      if (guard && !allowedByGuard(command, guard)) {
        return {
          exitCode: 99,
          output: `trava de check: comando recusado (não é um comando falso do teste): ${command}`,
        };
      }
      const result = await runCommand(shellCommand(command), cwd, undefined, timeoutMs);
      const output = (result.stdout + result.stderr).slice(-MAX_VALUE);
      return result.timedOut
        ? {
            exitCode: result.code,
            output: `${output}\ntimed out after ${timeoutMs} ms`,
            timedOut: true,
          }
        : { exitCode: result.code, output };
    },
  };
}
