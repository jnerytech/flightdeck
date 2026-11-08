/**
 * Issue #100: the git calls of a teleport, on the source and on the target. No hook, fsmonitor or
 * signature check (gpg.program) of the repository runs, and a call that runs out of time is killed
 * with what it started.
 */
import { killTree, runCommand } from "../board/command.ts";
import { FlightdeckError } from "../errors.ts";
import { whichOnPath } from "../which.ts";

export const TIMEOUT_MS = 120_000;
/** The `core.hooksPath` that holds no hook, on this platform. */
export const hooksOff = (platform: NodeJS.Platform = process.platform): string =>
  platform === "win32" ? "NUL" : "/dev/null";
/** No hook, fsmonitor or signature check (gpg.program) of the repository runs. */
export const SAFE = [
  "-c",
  `core.hooksPath=${hooksOff()}`,
  "-c",
  "core.fsmonitor=false",
  "-c",
  "log.showSignature=false",
];

/** One git call in `cwd`, with no hook, fsmonitor or gpg of the repository; null when it fails. */
export async function git(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<string | null> {
  // A daemon that has stopped starts nothing: a git started and killed afterwards can still write
  // (on Windows `taskkill` is not instant) into the folder the caller is about to clean.
  if (signal?.aborted) return null;
  // git-arg: a forwarder: every caller passes a checked revision (refArg/HEAD) or a value git gave
  const result = await runCommand(
    [whichOnPath("git") ?? "git", ...SAFE, ...args],
    cwd,
    undefined,
    TIMEOUT_MS,
    killTree,
    env,
    signal,
  );
  return result.code === 0 ? result.stdout.trim() : null;
}

/** Like `git`, but a failure is an error with git's own exit. */
export async function must(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<string> {
  const out = await git(cwd, args, env, signal);
  if (out === null) throw new FlightdeckError("internal", `git ${args[0]} failed`, "teleport_git");
  return out;
}
