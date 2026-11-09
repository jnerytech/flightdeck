import { whichOnPath } from "../which.ts";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  /** The command ran out of time and was killed. */
  timedOut?: boolean;
  /** The caller's signal fired and the command was killed. */
  aborted?: boolean;
}

/** Kills a process and everything it started: `taskkill /T` on Windows, the process group elsewhere. */
export async function killTree(
  pid: number,
  platform: string = process.platform,
  kill: (pid: number, signal: string) => void = process.kill,
  // The program is looked up on the current PATH: `Bun.spawn` alone keeps the one the process started with.
  spawn: (cmd: string[]) => unknown = ([program, ...args]) =>
    Bun.spawn([whichOnPath(program as string) ?? (program as string), ...args], {
      stdout: "ignore",
      stderr: "ignore",
    }).exited,
): Promise<void> {
  // Only a child's pid: a group kill with the daemon's own, 1 or a negative one would reach the
  // daemon or other processes.
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
  // Settles when taskkill ends: the caller can then use the tree's files and ports.
  if (platform === "win32") await spawn(["taskkill", "/PID", String(pid), "/T", "/F"]);
  else kill(-pid, "SIGKILL");
}

/**
 * Runs a command in `cwd` and collects its exit code and output; `input` goes to its stdin. With
 * `timeoutMs`, a command still running at the limit is killed with everything it started and the
 * result says `timedOut`.
 */
export async function runCommand(
  cmd: string[],
  cwd: string,
  input?: string,
  timeoutMs?: number,
  kill: (pid: number) => Promise<void> = killTree,
  /** Variables to add to the process's environment. */
  extraEnv: Record<string, string> = {},
  /** Kills the command and its tree when it fires (the daemon stopping). */
  signal?: AbortSignal,
): Promise<CommandResult> {
  // `env` explicitly: without it Bun passes the environment the process started with. Its own
  // process group (outside Windows), so the whole tree can be killed at the limit.
  const proc = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    detached: (timeoutMs !== undefined || signal !== undefined) && process.platform !== "win32",
  });
  let timedOut = false;
  let killing: Promise<void> = Promise.resolve();
  const timer =
    timeoutMs === undefined
      ? null
      : setTimeout(() => {
          timedOut = true;
          killing = kill(proc.pid).catch(() => {});
        }, timeoutMs);
  let aborted = false;
  const onAbort = () => {
    aborted = true;
    killing = killing.then(() => kill(proc.pid)).catch(() => {});
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (timer) clearTimeout(timer);
  signal?.removeEventListener("abort", onAbort);
  // A command that ran out of time is not given back before its tree is gone: its caller may
  // remove the folder it ran in.
  await killing;
  return {
    code,
    stdout,
    stderr,
    ...(timedOut ? { timedOut } : {}),
    ...(aborted ? { aborted } : {}),
  };
}

/** `git` from the current PATH, always with an explicit working directory. */
export function git(cwd: string, ...args: string[]): Promise<CommandResult> {
  // git-arg: the shared git helper: its callers are what the git-args ratchet checks
  return runCommand([whichOnPath("git") ?? "git", ...args], cwd);
}

/** The rarer settings of a capped run (S107: no eighth positional parameter). */
export interface LimitedMore {
  /** The byte the output is cut after when it goes past `limit`: a line break, or NUL for `-z`. */
  separator?: number;
  /** Aborting it kills the program like the time limit does, and the result says `aborted` (#905). */
  signal?: AbortSignal;
  /** Added to the process's environment for this call. */
  env?: Record<string, string>;
  /** The whole environment instead of the daemon's (#1361: a check gets an allowlist). */
  baseEnv?: Record<string, string>;
  /** Past `limit`, kill the program's whole tree, not only the program (#1361). */
  overflowKillsTree?: boolean;
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

/** The most stderr `runLimited` keeps; the rest is read and dropped (#806). */
const STDERR_MAX = 64 * 1024;

/**
 * How long the readers wait for the pipes to close once the tree was killed (#1361): a process that
 * left the group (`setsid`) keeps them open, and the call must not wait for it to end.
 */
const KILL_GRACE_MS = 2000;

/**
 * All of a stream is read, so its writer never blocks; only the first `max` bytes are kept.
 * `cancel` stops reading, and `text` then gives what was kept.
 */
function readCapped(
  stream: ReadableStream<Uint8Array>,
  max: number,
): { text: Promise<string>; cancel: () => void } {
  const reader = stream.getReader();
  const kept: Uint8Array[] = [];
  let size = 0;
  const text = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size < max) kept.push(value.subarray(0, max - size));
      size += value.length;
    }
    return Buffer.concat(kept).toString("utf8");
  })();
  return { text, cancel: () => void reader.cancel().catch(() => {}) };
}

/**
 * Runs a program, never through a shell, and reads at most `limit` bytes of its output: past it the
 * program is killed and the result says `truncated`, cut after the last `separator`. With
 * `timeoutMs`, a program still running at the limit is killed with everything it started and the
 * result says `timedOut`.
 */
export async function runLimited(
  cmd: string[],
  cwd: string,
  limit: number,
  timeoutMs?: number,
  kill: (pid: number) => Promise<void> = killTree,
  more?: LimitedMore,
): Promise<CommandResult & { truncated: boolean }> {
  const { separator = 10, signal, env, baseEnv, overflowKillsTree } = more ?? {};
  const proc = Bun.spawn(cmd, {
    cwd,
    env: { ...(baseEnv ?? process.env), ...env },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    // Its own process group (outside Windows), so the whole tree can be killed at the limit.
    detached: (timeoutMs !== undefined || signal !== undefined) && process.platform !== "win32",
  });
  let timedOut = false;
  let aborted = false;
  let killing: Promise<void> = Promise.resolve();
  // Read at the same time as stdout: a program that fills the pipe's buffer with stderr would stall.
  const errors = readCapped(proc.stderr, STDERR_MAX);
  const reader = proc.stdout.getReader();
  // Once the tree is killed, the readers get a short grace, then stop: what kept a pipe open
  // outside the group is not waited for (#1361).
  let grace: ReturnType<typeof setTimeout> | null = null;
  const killTreeNow = () => {
    killing = killing.then(() => kill(proc.pid)).catch(() => {});
    grace ??= setTimeout(() => {
      void reader.cancel().catch(() => {});
      errors.cancel();
    }, KILL_GRACE_MS);
  };
  // An abort kills the whole tree like the time limit does (#905).
  const onAbort = () => {
    aborted = true;
    killTreeNow();
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const timer =
    timeoutMs === undefined
      ? null
      : setTimeout(() => {
          timedOut = true;
          killTreeNow();
        }, timeoutMs);
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  let failure: unknown = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
      if (size > limit) {
        truncated = true;
        // A child it left would hold the pipes open, and stderr would never end.
        if (overflowKillsTree) killTreeNow();
        await reader.cancel();
        break;
      }
    }
  } catch (error) {
    // Reading failed: the tree goes too, and the cleanup below still runs before the error.
    failure = error;
    killTreeNow();
  } finally {
    // Past the limit, or when reading failed: the program does not go on writing to nobody.
    proc.kill();
  }
  const [stderr, code] = await Promise.all([errors.text, proc.exited]);
  if (timer) clearTimeout(timer);
  if (grace) clearTimeout(grace);
  signal?.removeEventListener("abort", onAbort);
  await killing;
  if (failure) throw failure;
  const all = Buffer.concat(chunks);
  const kept = truncated ? all.subarray(0, all.subarray(0, limit).lastIndexOf(separator) + 1) : all;
  return {
    code,
    stdout: kept.toString("utf8"),
    stderr,
    truncated,
    ...(timedOut ? { timedOut } : {}),
    ...(aborted ? { aborted } : {}),
  };
}
