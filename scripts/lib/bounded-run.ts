/**
 * Runs a hook command with a deadline (#273): its stdout ignored, the tail of its stderr kept, and
 * on timeout the whole process group killed, grandchildren too, so nothing it started keeps the
 * caller waiting.
 */
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";

export interface BoundedResult {
  /** The exit code; null when it was killed or could not start. */
  code: number | null;
  /** The last characters of its stderr, or why it could not start. */
  stderr: string;
  timedOut: boolean;
}

/** How much of the stderr is kept. */
const TAIL = 500;

export interface KillDeps {
  platform: NodeJS.Platform;
  /** Runs a program to its end (taskkill on Windows). */
  runSync: (program: string, args: string[]) => void;
  /** Sends a signal; a negative pid is a process group. */
  kill: (pid: number, signal: NodeJS.Signals) => void;
  systemRoot?: string;
}

const KILL: KillDeps = {
  platform: process.platform,
  runSync: (program, args) => {
    spawnSync(program, args, { stdio: "ignore" });
  },
  kill: (pid, signal) => process.kill(pid, signal),
  systemRoot: process.env.SystemRoot,
};

/** Kills a process and everything it started: its group on POSIX, its tree on Windows. */
export function killTree(pid: number, deps: KillDeps = KILL): void {
  try {
    if (deps.platform === "win32") {
      const taskkill = join(deps.systemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
      deps.runSync(taskkill, ["/T", "/F", "/PID", String(pid)]);
    } else deps.kill(-pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

export function runBounded(command: string[], timeoutMs: number): Promise<BoundedResult> {
  const [program = "", ...args] = command;
  return new Promise((done) => {
    let tail = "";
    let settled = false;
    const finish = (result: BoundedResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A grandchild may still hold the pipe: stop reading it rather than wait for its end.
      child.stderr?.destroy();
      done(result);
    };
    // Its own process group on POSIX, so a timeout reaches what it started.
    const child = spawn(program, args, {
      detached: process.platform !== "win32",
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      tail = (tail + chunk.toString("utf8")).slice(-TAIL);
    });
    child.on("error", (error) => finish({ code: null, stderr: error.message, timedOut: false }));
    child.on("exit", (code) => finish({ code, stderr: tail.trimEnd(), timedOut: false }));
    const timer = setTimeout(() => {
      if (child.pid !== undefined) killTree(child.pid);
      finish({ code: null, stderr: tail.trimEnd(), timedOut: true });
    }, timeoutMs);
  });
}
