/**
 * Runs a hook command with a deadline (#273): its output ignored (a hook inherits the environment
 * and may print a token, so nothing it prints reaches a log), and on timeout its whole process
 * group killed, grandchildren too, so nothing it started keeps the caller waiting.
 */
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";

export interface BoundedResult {
  /** The exit code; null when it was killed or could not start. */
  code: number | null;
  /** Why it could not start (the program's name and the error), else empty. */
  stderr: string;
  timedOut: boolean;
}

export interface KillDeps {
  platform: NodeJS.Platform;
  /** Runs a program to its end (taskkill on Windows). */
  runSync: (program: string, args: string[]) => void;
  /** Sends a signal; a negative pid is a process group. */
  kill: (pid: number, signal: NodeJS.Signals) => void;
  systemRoot?: string;
}

export const SYSTEM_KILL: KillDeps = {
  platform: process.platform,
  runSync: (program, args) => {
    spawnSync(program, args, { stdio: "ignore" });
  },
  kill: (pid, signal) => process.kill(pid, signal),
  systemRoot: process.env.SystemRoot,
};

/** Kills a process and everything it started: its group on POSIX, its tree on Windows. */
export function killTree(pid: number, deps: KillDeps = SYSTEM_KILL): void {
  try {
    if (deps.platform === "win32") {
      const taskkill = join(deps.systemRoot ?? String.raw`C:\Windows`, "System32", "taskkill.exe");
      deps.runSync(taskkill, ["/T", "/F", "/PID", String(pid)]);
    } else deps.kill(-pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

/** A started process, as runBounded reads it. */
export interface ChildLike {
  pid?: number;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "exit", listener: (code: number | null) => void): unknown;
}

/** What runBounded starts, times and kills with (#284: tests pass fakes, no real process or timer). */
export interface RunDeps {
  platform: NodeJS.Platform;
  spawn: (program: string, args: string[], options: { detached: boolean }) => ChildLike;
  setTimer: (fire: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
  killTree: (pid: number) => void;
}

export const SYSTEM_RUN: RunDeps = {
  platform: process.platform,
  spawn: (program, args, { detached }) =>
    spawn(program, args, { detached, stdio: "ignore", windowsHide: true }),
  setTimer: (fire, ms) => setTimeout(fire, ms),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  killTree: (pid) => killTree(pid),
};

export function runBounded(
  command: string[],
  timeoutMs: number,
  deps: RunDeps = SYSTEM_RUN,
): Promise<BoundedResult> {
  const [program = "", ...args] = command;
  return new Promise((done) => {
    let settled = false;
    // Declared first: a deps.spawn that reported at once would otherwise reach it before it exists.
    let timer: unknown;
    const finish = (result: BoundedResult) => {
      if (settled) return;
      settled = true;
      deps.clearTimer(timer);
      done(result);
    };
    // Its own process group on POSIX, so a timeout reaches what it started.
    const child = deps.spawn(program, args, { detached: deps.platform !== "win32" });
    child.on("error", (error) => finish({ code: null, stderr: error.message, timedOut: false }));
    child.on("exit", (code) => finish({ code, stderr: "", timedOut: false }));
    timer = deps.setTimer(() => {
      if (settled) return;
      if (child.pid !== undefined) deps.killTree(child.pid);
      finish({ code: null, stderr: "", timedOut: true });
    }, timeoutMs);
  });
}
