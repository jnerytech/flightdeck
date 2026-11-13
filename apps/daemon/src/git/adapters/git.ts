import {
  type CommandResult,
  killTree,
  type LimitedMore,
  runCommand,
  runLimited,
  whichOnPath,
} from "../../kernel/index.ts";

/** `git` from the current PATH, always with an explicit working directory. */
export function git(cwd: string, ...args: string[]): Promise<CommandResult> {
  // git-arg: the shared git helper: its callers are what the git-args ratchet checks
  return runCommand([whichOnPath("git") ?? "git", ...args], cwd);
}

/**
 * Like `git`, but reads at most `limit` bytes of output: when git writes more it is killed and the
 * result says `truncated`, with the output cut at its last whole line (a change of 200 MB must not
 * be held in memory, issue #329).
 */
export function gitLimited(
  cwd: string,
  limit: number,
  ...args: string[]
): Promise<CommandResult & { truncated: boolean }> {
  return gitLimitedFor(cwd, limit, args);
}

/**
 * Like `gitLimited`, with a time limit (issue #100): a git still running at `timeoutMs` is killed
 * with everything it started, and the result says `timedOut`.
 */
export function gitLimitedFor(
  cwd: string,
  limit: number,
  args: string[],
  timeoutMs?: number,
  kill: (pid: number) => Promise<void> = killTree,
  more?: LimitedMore,
): Promise<CommandResult & { truncated: boolean }> {
  // git-arg: the capped git helper: its callers are what the git-args ratchet checks
  return runLimited([whichOnPath("git") ?? "git", ...args], cwd, limit, timeoutMs, kill, more);
}
