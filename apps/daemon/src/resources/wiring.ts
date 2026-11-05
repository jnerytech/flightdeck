import type { ProcReader } from "./resources.ts";
import { Resources } from "./resources.ts";

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
  terminals(): Array<{ terminalId: string; cwd: string; command: string; exitCode: number | null }>;
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

export function createResources(_deps: ResourcesDeps): Resources {
  return new Resources({
    proc: null,
    ownPid: 0,
    sessions: () => [],
    terminals: () => [],
    memory: () => ({ totalBytes: 0, freeBytes: 0 }),
    disk: async () => null,
    loadPercent: () => null,
    kill: () => {},
  });
}
