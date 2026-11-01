import type { TerminalManager } from "../terminal/terminal-manager.ts";
import type { RunHost } from "./manager.ts";

export interface TreeKillDeps {
  platform?: NodeJS.Platform;
  /** `process.kill`. */
  signal?: (pid: number, signal: string) => void;
  /** Runs a command to completion (`taskkill` on Windows). */
  run?: (argv: string[]) => void;
}

/**
 * Ends a process and everything it started, whatever the children do with signals: SIGKILL to the
 * process group on Linux (the PTY's child leads its own), `taskkill /T /F` on Windows. A tree that
 * is already gone is not an error.
 */
export function killTree(pid: number, deps: TreeKillDeps = {}): void {
  // Never this daemon's own group (-pid would be it), init's, or a pid that is not one.
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
  const platform = deps.platform ?? process.platform;
  try {
    if (platform === "win32")
      // Not waited for: the tree is gone when taskkill ends, and the daemon has other things to do.
      (deps.run ?? ((cmd) => void Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" })))([
        "taskkill",
        "/PID",
        String(pid),
        "/T",
        "/F",
      ]);
    else (deps.signal ?? process.kill)(-pid, "SIGKILL");
  } catch {
    // Already gone, or taskkill is not there: nothing left to end.
  }
}

export type TreeKiller = (pid: number) => void;

/** The run environment's processes as tabs: each one a terminal of the host's terminal manager. */
export function terminalRunHost(
  manager: Pick<TerminalManager, "open" | "close" | "pidOf">,
  options: { treeKill?: TreeKiller } = {},
): RunHost {
  const treeKill = options.treeKill ?? killTree;
  return {
    spawn: (request) => {
      let end!: (exitCode: number) => void;
      const exited = new Promise<number>((resolve) => {
        end = resolve;
      });
      const { terminalId } = manager.open({
        cwd: request.cwd,
        command: request.argv,
        env: request.env,
        cols: 120,
        rows: 30,
        onExit: end,
      });
      return { terminalId, exited };
    },
    kill: (terminalId) => {
      const pid = manager.pidOf(terminalId);
      if (pid === null) return;
      // The tree first, while its leader lives: after it, the children could not be found.
      treeKill(pid);
      manager.close(terminalId, true);
    },
  };
}
