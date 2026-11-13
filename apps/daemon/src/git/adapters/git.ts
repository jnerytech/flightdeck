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
 * Like `git`, with the two things a few callers add: text for git's stdin (`check-ignore --stdin`)
 * and variables for its environment (the snapshots' own index file and author).
 */
export function gitWith(
  cwd: string,
  args: string[],
  more: { input?: string; env?: Record<string, string> } = {},
): Promise<CommandResult> {
  // git-arg: the git helper with stdin and environment: its callers are what the git-args ratchet checks
  return runCommand(
    [whichOnPath("git") ?? "git", ...args],
    cwd,
    more.input,
    undefined,
    killTree,
    more.env,
  );
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

/**
 * Like `git`, but the output comes back as bytes, stderr dropped: a file's content (`cat-file blob`)
 * is not text, and decoding it would corrupt a binary file.
 */
export async function gitBytes(
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: Buffer }> {
  // git-arg: the byte-exact git helper: its callers are what the git-args ratchet checks
  const proc = Bun.spawn([whichOnPath("git") ?? "git", ...args], {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "ignore",
  });
  const [stdout, code] = await Promise.all([
    new Response(proc.stdout).arrayBuffer().then((b) => Buffer.from(b)),
    proc.exited,
  ]);
  return { code, stdout };
}
