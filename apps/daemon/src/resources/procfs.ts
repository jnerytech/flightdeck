import type { ProcReader, ProcStat } from "./resources.ts";

/** Stub: wrong values until the area is green. */
export function parseStat(_line: string): ProcStat | null {
  return null;
}

export function procfsReader(_opts: {
  root?: string;
  pageSize?: number;
  ticksPerSecond?: number;
}): ProcReader {
  return {
    pageSize: 0,
    ticksPerSecond: 0,
    pids: async () => [],
    stat: async () => null,
    cwd: async () => null,
    uptimeSec: async () => 0,
  };
}
