import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isCheckEnvName } from "@flightdeck/protocol";
import { shellCommand } from "../board/setup.ts";
import { killTree, runCommand, runLimited, whichOnPath } from "../kernel/index.ts";
import { MAX_VALUE } from "./domain/interpolate.ts";

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
async function allowedByGuard(command: string, guard: string): Promise<boolean> {
  const executable = whichOnPath(command.trim().split(/\s+/)[0] ?? "") ?? "";
  const allowed = (await readFile(join(guard, "allowed"), "utf8")).split(/\r?\n/).filter(Boolean);
  if (executable && allowed.some((dir) => executable.startsWith(dir))) return true;
  await appendFile(join(guard, "refused.log"), `${command}\n`);
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
      if (guard && !(await allowedByGuard(command, guard))) {
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

/** Issue #1361: the most output a bounded check keeps (stdout and stderr together) before it is killed. */
export const CHECK_OUTPUT_MAX = 4 * 1024 * 1024;

/** What a bounded check gives back: the whole output, bounded. */
export interface BoundedCheckResult extends CheckResult {
  /** The caller's signal fired and the check was killed. */
  aborted?: boolean;
  /** It printed more than the bound and was killed. */
  tooLarge?: boolean;
}

/** Issue #1361: runs the watch's and the check loop's checks. */
export interface BoundedCheckRunner {
  run(
    command: string,
    cwd: string,
    timeoutMs?: number,
    signal?: AbortSignal,
    /** The project's extra names (`checkEnv`); only those the rule allows are added. */
    envNames?: readonly string[],
  ): Promise<BoundedCheckResult>;
}

/** The daemon's variables a bounded check keeps on POSIX (names are case-sensitive there). */
const POSIX_ENV = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TZ",
  "TMPDIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
]);

/** The same on Windows, in upper case: Windows reads `Path` and `PATH` as one name. */
const WINDOWS_ENV = new Set([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "SYSTEMDRIVE",
  "COMSPEC",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "TEMP",
  "TMP",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OS",
]);

/**
 * The environment a bounded check gets: only the allowlisted names of the daemon's own, with
 * their own spelling, and `CI=1`. Keys and Flightdeck's variables stay out (#1361).
 */
export function checkEnvironment(
  source: Record<string, string | undefined>,
  platform: string = process.platform,
  extra: readonly string[] = [],
): Record<string, string> {
  const windows = platform === "win32";
  // The project's names are checked again at use: the stored list is never trusted blindly.
  const added = new Set(
    extra.filter(isCheckEnvName).map((name) => (windows ? name.toUpperCase() : name)),
  );
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    const key = windows ? name.toUpperCase() : name;
    const kept = (windows ? WINDOWS_ENV.has(key) : POSIX_ENV.has(name)) || added.has(key);
    if (kept && value !== undefined) env[name] = value;
  }
  env.CI = "1";
  return env;
}

/**
 * Issue #1361: like `shellCheckRunner`, with the allowlisted environment, the output bounded at
 * `outputMax` (past it the check is killed with its tree), an abort signal, and the whole output.
 */
export function boundedCheckRunner(
  env: Record<string, string | undefined> = process.env,
  outputMax: number = CHECK_OUTPUT_MAX,
): BoundedCheckRunner {
  return {
    async run(command, cwd, timeoutMs, signal, envNames = []) {
      const guard = env[CHECK_GUARD_ENV];
      if (guard && !(await allowedByGuard(command, guard))) {
        return {
          exitCode: 99,
          output: `trava de check: comando recusado (não é um comando falso do teste): ${command}`,
        };
      }
      // A time limit always: only a timed or signalled command gets its own process group, which
      // is what the kill reaches. Stdout and stderr together count toward the bound; stderr keeps
      // its first 64 KB.
      const limit = timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
      const result = await runLimited(shellCommand(command), cwd, outputMax, limit, killTree, {
        signal,
        baseEnv: checkEnvironment(env, process.platform, envNames),
        overflowKillsTree: true,
      });
      return {
        exitCode: result.code,
        output: result.stdout + result.stderr,
        ...(result.timedOut ? { timedOut: true } : {}),
        ...(result.aborted ? { aborted: true } : {}),
        ...(result.truncated ? { tooLarge: true } : {}),
      };
    },
  };
}
