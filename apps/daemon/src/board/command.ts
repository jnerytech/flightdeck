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
  /**
   * Past `limit`, kill the program's whole tree, not only the program, and count stderr toward the
   * limit too (#1361: a check that floods stderr is stopped, not left to its time limit).
   */
  overflowKillsTree?: boolean;
  /** Starts the program (a test seam: a pipe that fails cannot be provoked with a real one). */
  spawn?: (cmd: string[], options: SpawnOptions) => Spawned;
}

/** What `runLimited` asks of a started program. */
export interface Spawned {
  pid: number;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
}

export interface SpawnOptions {
  cwd: string;
  env: Record<string, string | undefined>;
  detached: boolean;
}

const spawnPiped = (cmd: string[], options: SpawnOptions): Spawned =>
  Bun.spawn(cmd, { ...options, stdout: "pipe", stderr: "pipe", stdin: "ignore" });

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
  onBytes?: (n: number) => void,
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
      onBytes?.(value.length);
    }
    return Buffer.concat(kept).toString("utf8");
  })();
  return { text, cancel: () => void reader.cancel().catch(() => {}) };
}

/**
 * Stops a program at its time limit or when the caller's signal fires (#905): the whole tree is
 * killed, one kill after the other, and the readers get a short grace before `cutReaders` stops
 * them (#1361). `release` clears the timers and waits for the kills, whatever happened.
 */
function stopOnLimit(
  pid: number,
  kill: (pid: number) => Promise<void>,
  when: { timeoutMs?: number; signal?: AbortSignal },
  cutReaders: () => void,
) {
  const { timeoutMs, signal } = when;
  const state = { timedOut: false, aborted: false };
  let killing: Promise<void> = Promise.resolve();
  let grace: ReturnType<typeof setTimeout> | null = null;
  const killTree = () => {
    killing = killing.then(() => kill(pid)).catch(() => {});
    grace ??= setTimeout(cutReaders, KILL_GRACE_MS);
  };
  // An abort kills the whole tree like the time limit does (#905).
  const onAbort = () => {
    state.aborted = true;
    killTree();
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const timer =
    timeoutMs === undefined
      ? null
      : setTimeout(() => {
          state.timedOut = true;
          killTree();
        }, timeoutMs);
  return {
    killTree,
    get timedOut() {
      return state.timedOut;
    },
    get aborted() {
      return state.aborted;
    },
    async release() {
      if (timer) clearTimeout(timer);
      if (grace) clearTimeout(grace);
      signal?.removeEventListener("abort", onAbort);
      await killing;
    },
  };
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
  const {
    separator = 10,
    signal,
    env,
    baseEnv,
    overflowKillsTree,
    spawn = spawnPiped,
  } = more ?? {};
  const proc = spawn(cmd, {
    cwd,
    env: { ...(baseEnv ?? process.env), ...env },
    // Its own process group (outside Windows), so the whole tree can be killed at the limit.
    detached: (timeoutMs !== undefined || signal !== undefined) && process.platform !== "win32",
  });
  let size = 0;
  let truncated = false;
  const reader = proc.stdout.getReader();
  // Past the limit the tree goes and stdout stops being read (#1361).
  const overflow = () => {
    if (truncated) return;
    truncated = true;
    stopper.killTree();
    void reader.cancel().catch(() => {});
  };
  // Read at the same time as stdout: a program that fills the pipe's buffer with stderr would stall.
  const errors = readCapped(
    proc.stderr,
    STDERR_MAX,
    overflowKillsTree
      ? (n) => {
          size += n;
          if (size > limit) overflow();
        }
      : undefined,
  );
  // Once the tree is killed, the readers get a short grace, then stop: what kept a pipe open
  // outside the group is not waited for (#1361).
  const stopper = stopOnLimit(proc.pid, kill, { timeoutMs, signal }, () => {
    void reader.cancel().catch(() => {});
    errors.cancel();
  });
  const chunks: Uint8Array[] = [];
  let failed = false;
  let failure: unknown;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
      if (size > limit) {
        // A child it left would hold the pipes open, and stderr would never end.
        if (overflowKillsTree) overflow();
        truncated = true;
        await reader.cancel();
        break;
      }
    }
  } catch (error) {
    // Reading failed: the tree goes too, and the cleanup below still runs before the error.
    failed = true;
    failure = error;
    stopper.killTree();
  } finally {
    // Past the limit, or when reading failed: the program does not go on writing to nobody.
    proc.kill();
  }
  let stderr: string;
  let code: number;
  try {
    [stderr, code] = await Promise.all([errors.text, proc.exited]);
  } finally {
    // Even when reading stderr failed: no timer may fire a kill at a pid that was given back.
    await stopper.release();
  }
  if (failed) throw failure;
  const all = Buffer.concat(chunks);
  // Only stdout that went past the limit itself is cut; a stop for stderr keeps what stdout gave.
  const kept =
    all.length > limit ? all.subarray(0, all.subarray(0, limit).lastIndexOf(separator) + 1) : all;
  return {
    code,
    stdout: kept.toString("utf8"),
    stderr,
    truncated,
    ...(stopper.timedOut ? { timedOut: true } : {}),
    ...(stopper.aborted ? { aborted: true } : {}),
  };
}
