/**
 * The Resources panel's rules over what /proc says: which processes belong to a terminal or a
 * session, what a group of them uses, and which `claude` is a leftover of a session that is over
 * (positive evidence only). Plain values in, plain values out: the sampler reads /proc, kills and
 * keeps the clock in `../resources.ts`.
 */
import type { ResourceOrphan } from "@flightdeck/protocol";

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
  /** When it was last touched: for a session that is over, about when its process should have ended. */
  updatedAt: string;
  /** Whether it can still own a process. */
  active: boolean;
}

/** A process younger than this may be a short query on its way out, not a leftover. */
const ORPHAN_MIN_AGE_SEC = 60;

/**
 * A process counts as a session's when it started this long before the session was created or after
 * it was last touched: clocks of the two readings are not the same one.
 */
const SESSION_SLACK_MS = 10_000;

/** A process names itself, so its name is cleaned of control characters and cut. */
const MAX_NAME = 32;
export const cleanName = (name: string) =>
  [...name]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join("")
    .slice(0, MAX_NAME);

/** A folder removed under a running process reads `<path> (deleted)`: it is still that session's. */
export const sameFolder = (cwd: string) => cwd.replace(/ \(deleted\)$/, "");

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The processes each parent has. */
export function childrenOf(stats: Map<number, ProcStat>): Map<number, ProcStat[]> {
  const children = new Map<number, ProcStat[]>();
  for (const stat of stats.values()) {
    const siblings = children.get(stat.ppid);
    if (siblings) siblings.push(stat);
    else children.set(stat.ppid, [stat]);
  }
  return children;
}

/** A process and everything under it. A pid reused during the scan can make the parents loop: every process is visited once. */
export function treeOf(children: Map<number, ProcStat[]>, root: ProcStat): ProcStat[] {
  const out: ProcStat[] = [];
  const seen = new Set<number>();
  const walk = (node: ProcStat) => {
    if (seen.has(node.pid)) return;
    seen.add(node.pid);
    out.push(node);
    for (const child of children.get(node.pid) ?? []) walk(child);
  };
  walk(root);
  return out;
}

/** What a group of processes uses: memory now, and CPU over the window since its last sample. */
export function measureNodes(
  nodes: ProcStat[],
  samples: Map<number, { ticks: number; at: number }>,
  at: number,
  proc: ProcReader,
) {
  let deltaTicks = 0;
  let known = false;
  let seconds = 0;
  for (const node of nodes) {
    const before = samples.get(node.pid);
    if (!before) continue;
    known = true;
    deltaTicks += Math.max(0, node.cpuTicks - before.ticks);
    seconds = Math.max(seconds, (at - before.at) / 1000);
  }
  const cpuPercent =
    known && seconds > 0 ? round1((deltaTicks / proc.ticksPerSecond / seconds) * 100) : null;
  return {
    rssBytes: nodes.reduce((sum, n) => sum + n.rssPages * proc.pageSize, 0),
    cpuPercent,
    processes: nodes.length,
    names: [...new Set(nodes.map((n) => cleanName(n.name)))],
  };
}

interface OrphanSearch {
  /** The session programs the daemon started, by folder. */
  byCwd: Map<string, ProcStat[]>;
  /** The folders where an active session lives. */
  taken: Map<string, unknown>;
  /** The sessions that are over, by folder. */
  overByCwd: Map<string, ResourceSession[]>;
  uptime: number;
  at: number;
  proc: ProcReader;
  tree(root: ProcStat): ProcStat[];
}

/** The session programs left over from a session that is over (positive evidence only). */
export function findOrphans(search: OrphanSearch): ResourceOrphan[] {
  const { byCwd, taken, overByCwd, uptime, at, proc, tree } = search;
  const orphans: ResourceOrphan[] = [];
  for (const [folder, candidates] of byCwd) {
    // Where an active session lives, which process is whose cannot be told: none is an orphan.
    if (taken.has(folder)) continue;
    for (const root of candidates) {
      const ageSec = Math.max(0, Math.round(uptime - root.startTicks / proc.ticksPerSecond));
      if (ageSec < ORPHAN_MIN_AGE_SEC) continue;
      const startedAt = at - ageSec * 1000;
      const lived = (overByCwd.get(folder) ?? []).some(
        (s) =>
          startedAt >= Date.parse(s.createdAt) - SESSION_SLACK_MS &&
          startedAt <= Date.parse(s.updatedAt) + SESSION_SLACK_MS,
      );
      if (!lived) continue;
      orphans.push({
        pid: root.pid,
        name: cleanName(root.name),
        rssBytes: tree(root).reduce((sum, n) => sum + n.rssPages * proc.pageSize, 0),
        ageSec,
        startTicks: root.startTicks,
      });
    }
  }
  return orphans;
}
