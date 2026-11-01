import { whichOnPath } from "../which.ts";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  /** The command ran out of time and was killed. */
  timedOut?: boolean;
}

/** Kills a process and everything it started: `taskkill /T` on Windows, the process group elsewhere. */
export function killTree(
  pid: number,
  platform: string = process.platform,
  kill: (pid: number, signal: string) => void = process.kill,
  // The program is looked up on the current PATH: `Bun.spawnSync` alone keeps the one the process started with.
  spawn: (cmd: string[]) => void = ([program, ...args]) =>
    void Bun.spawnSync([whichOnPath(program as string) ?? (program as string), ...args]),
): void {
  // Only a child's pid: a group kill with the daemon's own, 1 or a negative one would reach the
  // daemon or other processes.
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
  if (platform === "win32") spawn(["taskkill", "/PID", String(pid), "/T", "/F"]);
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
): Promise<CommandResult> {
  // `env` explicitly: without it Bun passes the environment the process started with. Its own
  // process group (outside Windows), so the whole tree can be killed at the limit.
  const proc = Bun.spawn(cmd, {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    detached: timeoutMs !== undefined && process.platform !== "win32",
  });
  let timedOut = false;
  const timer =
    timeoutMs === undefined
      ? null
      : setTimeout(() => {
          timedOut = true;
          killTree(proc.pid);
        }, timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (timer) clearTimeout(timer);
  return { code, stdout, stderr, ...(timedOut ? { timedOut } : {}) };
}

/** `git` from the current PATH, always with an explicit working directory. */
export function git(cwd: string, ...args: string[]): Promise<CommandResult> {
  return runCommand([whichOnPath("git") ?? "git", ...args], cwd);
}
