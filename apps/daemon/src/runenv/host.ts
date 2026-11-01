import type { TerminalManager } from "../terminal/terminal-manager.ts";
import type { RunHost } from "./manager.ts";

export interface TreeKillDeps {
  platform?: NodeJS.Platform;
  /** `process.kill`. */
  signal?: (pid: number, signal: string) => void;
  /** Runs a command to completion (`taskkill` on Windows). */
  run?: (argv: string[]) => unknown;
}

/**
 * Ends a process and everything it started, whatever the children do with signals: SIGKILL to the
 * process group on Linux (the PTY's child leads its own), `taskkill /T /F` on Windows. A tree that
 * is already gone is not an error.
 */
export async function killTree(pid: number, deps: TreeKillDeps = {}): Promise<void> {
  // Never this daemon's own group (-pid would be it), init's, or a pid that is not one.
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
  const platform = deps.platform ?? process.platform;
  try {
    if (platform === "win32") {
      // Settles when taskkill ends: whoever waits for it can then use the tree's files and ports.
      await (deps.run ?? runTaskkill)(["taskkill", "/PID", String(pid), "/T", "/F"]);
    } else (deps.signal ?? process.kill)(-pid, "SIGKILL");
  } catch {
    // Already gone, or taskkill is not there: nothing left to end.
  }
}

/** Runs `taskkill` and settles when it has exited, without holding the event loop meanwhile. */
async function runTaskkill(argv: string[]): Promise<void> {
  await Bun.spawn(argv, { stdout: "ignore", stderr: "ignore" }).exited;
}

/** Ends a process tree; may return a promise that settles when the tree is gone. */
export type TreeKiller = (pid: number) => unknown;

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
    kill: async (terminalId) => {
      const pid = manager.pidOf(terminalId);
      if (pid === null) return;
      // The tree first, while its leader lives: after it, the children could not be found. The
      // terminal closes at once; this settles when the tree is gone.
      const tree = treeKill(pid);
      manager.close(terminalId, true);
      await tree;
    },
  };
}
