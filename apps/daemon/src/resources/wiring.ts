import { type ProcReader, Resources } from "./resources.ts";

export interface ResourcesDeps {
  platform: NodeJS.Platform;
  ownPid: number;
  dataDir: string;
  sessions(): Array<{
    id: string;
    name: string | null;
    cwd: string;
    status: string;
    createdAt: string;
  }>;
  terminals(): Array<{
    terminalId: string;
    cwd: string;
    command: string;
    exitCode: number | null;
  }>;
  pidOf(terminalId: string): number | null;
  totalmem(): number;
  freemem(): number;
  loadavg(): number[];
  cpus(): number;
  statfs(path: string): Promise<{ blocks: number; bsize: number; bavail: number }>;
  kill(pid: number, signal: NodeJS.Signals): void;
  /** The /proc reader; only used on Linux. */
  proc: ProcReader | undefined;
}

/** Statuses of a session that has no process any more. */
const GONE = new Set(["ended", "error"]);

/**
 * The host's resources over what the daemon already has: its sessions and terminals, and the OS
 * for the host's numbers. Processes are measured through `/proc`, so only on Linux; macOS and
 * Windows get the host's memory, disk and (where there is one) load, and say the rest is not measured.
 */
export function createResources(deps: ResourcesDeps): Resources {
  return new Resources({
    proc: deps.platform === "linux" && deps.proc ? deps.proc : null,
    ownPid: deps.ownPid,
    sessions: () =>
      deps.sessions().map((s) => ({
        id: s.id,
        name: s.name,
        cwd: s.cwd,
        createdAt: s.createdAt,
        active: !GONE.has(s.status),
      })),
    terminals: () =>
      deps
        .terminals()
        .filter((t) => t.exitCode === null)
        .map((t) => ({
          id: t.terminalId,
          name: t.command,
          cwd: t.cwd,
          pid: deps.pidOf(t.terminalId),
        })),
    memory: () => ({ totalBytes: deps.totalmem(), freeBytes: deps.freemem() }),
    disk: async () => {
      try {
        const { blocks, bsize, bavail } = await deps.statfs(deps.dataDir);
        return { totalBytes: blocks * bsize, freeBytes: bavail * bsize };
      } catch {
        return null;
      }
    },
    loadPercent: () => {
      const cores = deps.cpus();
      // Windows has no load average: it reads 0 there.
      if (cores <= 0 || deps.platform === "win32") return null;
      return Math.round(((deps.loadavg()[0] ?? 0) / cores) * 100);
    },
    kill: (pid) => deps.kill(pid, "SIGTERM"),
  });
}
