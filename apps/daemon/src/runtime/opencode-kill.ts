import type { SpawnedAcp } from "./acp/client.ts";

/** The real kill of a process tree: a detached run and a signal to a process group. */
export const REAL_KILL_DEPS = {
  run(argv: string[]): void {
    Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  },
  killGroup(pid: number, signal: NodeJS.Signals): void {
    process.kill(-pid, signal);
  },
};

/**
 * Windows: `taskkill /PID <pid> /T /F` takes the tree. Elsewhere the child leads its own process
 * group, so the group gets SIGTERM, then SIGKILL when forced; the process alone if the group is gone.
 */
export function treeKiller(
  platform: NodeJS.Platform,
  deps: { run: (argv: string[]) => void; killGroup: (pid: number, signal: NodeJS.Signals) => void },
): (child: Pick<SpawnedAcp, "pid" | "kill">, force: boolean) => void {
  return (child, force) => {
    if (platform === "win32") {
      deps.run(["taskkill", "/PID", String(child.pid), "/T", "/F"]);
      return;
    }
    try {
      deps.killGroup(child.pid, force ? "SIGKILL" : "SIGTERM");
    } catch {
      child.kill();
    }
  };
}
