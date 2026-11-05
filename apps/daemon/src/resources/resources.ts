import type { ResourcesSnapshot } from "@flightdeck/protocol";

/** One process as /proc says it: its name only, never its arguments or environment. */
export interface ProcStat {
  pid: number;
  ppid: number;
  name: string;
  /** User plus system CPU time, in clock ticks. */
  cpuTicks: number;
  /** When it started, in clock ticks after the boot. */
  startTicks: number;
  rssPages: number;
}

/** What the sampler reads from the platform. The real one reads /proc; tests give their own. */
export interface ProcReader {
  pids(): Promise<number[]>;
  stat(pid: number): Promise<ProcStat | null>;
  cwd(pid: number): Promise<string | null>;
  uptimeSec(): Promise<number>;
  pageSize: number;
  ticksPerSecond: number;
}

export interface ResourceSession {
  id: string;
  name: string | null;
  cwd: string;
  createdAt: string;
  /** Whether it can still own a process. */
  active: boolean;
}

export interface ResourceTerminal {
  id: string;
  name: string | null;
  cwd: string;
  pid: number | null;
}

export interface ResourcesOptions {
  /** The per-process reader; null where the platform has none (macOS, Windows). */
  proc: ProcReader | null;
  ownPid: number;
  sessions(): ResourceSession[];
  terminals(): ResourceTerminal[];
  memory(): { totalBytes: number; freeBytes: number };
  disk(): Promise<{ totalBytes: number; freeBytes: number } | null>;
  loadPercent(): number | null;
  kill(pid: number): void;
  now?: () => number;
}

export class Resources {
  constructor(_opts: ResourcesOptions) {}

  async snapshot(): Promise<ResourcesSnapshot> {
    return {
      at: "",
      memory: { totalBytes: 0, freeBytes: 0 },
      disk: null,
      loadPercent: null,
      measured: false,
      reason: null,
      rows: [],
      orphans: [],
    };
  }

  async endOrphan(_pid: number): Promise<void> {}
}
