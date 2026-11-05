import { statfs } from "node:fs/promises";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import { procfsReader } from "./procfs.ts";
import { type ProcReader, Resources } from "./resources.ts";

export interface ResourcesDeps {
  dataDir: string;
  sessions(): Array<{
    id: string;
    name: string | null;
    cwd: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
  terminals(): Array<{
    terminalId: string;
    cwd: string;
    command: string;
    exitCode: number | null;
  }>;
  pidOf(terminalId: string): number | null;
  /** What follows is the machine's own; tests give their own, so no real process or disk is read. */
  platform?: NodeJS.Platform;
  ownPid?: number;
  totalmem?(): number;
  freemem?(): number;
  loadavg?(): number[];
  cpus?(): number;
  statfs?(path: string): Promise<{ blocks: number; bsize: number; bavail: number }>;
  kill?(pid: number, signal: NodeJS.Signals): void;
  /** The /proc reader; only used on Linux. */
  proc?: ProcReader;
  /** Where /proc is (tests give a temp folder shaped like it). */
  procRoot?: string;
  /** What the machine says of itself: `PAGESIZE` and `CLK_TCK` (tests give their own). */
  sysconf?(name: "PAGESIZE" | "CLK_TCK"): number | null;
}

/** Statuses of a session that has no process any more. */
const GONE = new Set(["ended", "error"]);

/**
 * The host's resources over what the daemon already has: its sessions and terminals, and the OS
 * for the host's numbers. Processes are measured through `/proc`, so only on Linux; macOS and
 * Windows get the host's memory, disk and (where there is one) load, and say the rest is not measured.
 */
export function createResources(given: ResourcesDeps): Resources {
  const deps = {
    platform: process.platform,
    ownPid: process.pid,
    totalmem,
    freemem,
    loadavg,
    cpus: () => cpus().length,
    statfs: (path: string) => statfs(path),
    kill: (pid: number, signal: NodeJS.Signals) => void process.kill(pid, signal),
    ...given,
  };
  const ask = deps.sysconf ?? getconf;
  const proc =
    deps.platform === "linux"
      ? (deps.proc ??
        procfsReader({
          root: deps.procRoot ?? "/proc",
          pageSize: defaultSysconf(ask, "PAGESIZE"),
          ticksPerSecond: defaultSysconf(ask, "CLK_TCK"),
        }))
      : null;
  return new Resources({
    proc,
    ownPid: deps.ownPid,
    sessions: () =>
      deps.sessions().map((s) => ({
        id: s.id,
        name: s.name,
        cwd: s.cwd,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
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

/** The machine's value of `name` (`getconf`), or the usual one when it cannot say. */
export function defaultSysconf(
  ask: (name: "PAGESIZE" | "CLK_TCK") => number | null,
  name: "PAGESIZE" | "CLK_TCK",
): number {
  const value = ask(name);
  return value !== null && Number.isFinite(value) && value > 0
    ? value
    : name === "PAGESIZE"
      ? 4096
      : 100;
}

/** Asks `getconf`; null when it is not there or answers something else. */
export function getconf(name: "PAGESIZE" | "CLK_TCK"): number | null {
  try {
    const out = Bun.spawnSync(["getconf", name], { stdout: "pipe", stderr: "ignore" });
    const value = Number.parseInt(out.stdout.toString().trim(), 10);
    return out.exitCode === 0 && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
