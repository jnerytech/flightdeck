import type { ResourceOrphan, ResourceRow, ResourcesSnapshot } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";

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

/** A process younger than this may be a short query on its way out, not a leftover. */
const ORPHAN_MIN_AGE_SEC = 60;

/** The programs the daemon starts for a session; only these are ever called orphans. */
const SESSION_PROGRAMS = new Set(["claude"]);

interface Sample {
  ticks: number;
  at: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export class Resources {
  private readonly now: () => number;
  /** CPU time of each process at the last snapshot: the only state, and no timer. */
  private samples = new Map<number, Sample>();

  constructor(private readonly opts: ResourcesOptions) {
    this.now = opts.now ?? Date.now;
  }

  async snapshot(): Promise<ResourcesSnapshot> {
    const at = this.now();
    const base = {
      at: new Date(at).toISOString(),
      memory: this.opts.memory(),
      disk: await this.opts.disk(),
      loadPercent: this.opts.loadPercent(),
    };
    const proc = this.opts.proc;
    if (!proc) {
      return { ...base, measured: false, reason: "platform", rows: [], orphans: [] };
    }
    const stats = new Map<number, ProcStat>();
    for (const pid of await proc.pids()) {
      const stat = await proc.stat(pid);
      if (stat) stats.set(pid, stat);
    }
    const children = new Map<number, ProcStat[]>();
    for (const stat of stats.values()) {
      children.set(stat.ppid, [...(children.get(stat.ppid) ?? []), stat]);
    }
    const tree = (root: ProcStat): ProcStat[] => {
      const out: ProcStat[] = [];
      const walk = (node: ProcStat) => {
        out.push(node);
        for (const child of children.get(node.pid) ?? []) walk(child);
      };
      walk(root);
      return out;
    };
    const measure = (nodes: ProcStat[]) => {
      let deltaTicks = 0;
      let known = false;
      let seconds = 0;
      for (const node of nodes) {
        const before = this.samples.get(node.pid);
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
        names: [...new Set(nodes.map((n) => n.name))],
      };
    };

    const terminals = this.opts.terminals();
    const terminalPids = new Set(terminals.flatMap((t) => (t.pid === null ? [] : [t.pid])));
    const rows: ResourceRow[] = [];
    for (const terminal of terminals) {
      const root = terminal.pid === null ? undefined : stats.get(terminal.pid);
      rows.push({
        kind: "terminal",
        id: terminal.id,
        name: terminal.name,
        cwd: terminal.cwd,
        ...(root
          ? measure(tree(root))
          : { rssBytes: 0, cpuPercent: null, processes: 0, names: [] }),
      });
    }

    // The session programs the daemon started, by folder, in the order they started.
    const roots = (children.get(this.opts.ownPid) ?? []).filter(
      (stat) => SESSION_PROGRAMS.has(stat.name) && !terminalPids.has(stat.pid),
    );
    const byCwd = new Map<string, ProcStat[]>();
    for (const root of roots) {
      const cwd = await proc.cwd(root.pid);
      if (cwd === null) continue;
      byCwd.set(
        cwd,
        [...(byCwd.get(cwd) ?? []), root].sort((a, b) => a.startTicks - b.startTicks),
      );
    }
    const owned = new Set<number>();
    const active = this.opts.sessions().filter((s) => s.active);
    const sessionsByCwd = new Map<string, ResourceSession[]>();
    for (const session of active) {
      sessionsByCwd.set(session.cwd, [...(sessionsByCwd.get(session.cwd) ?? []), session]);
    }
    for (const [cwd, sessions] of sessionsByCwd) {
      const candidates = byCwd.get(cwd) ?? [];
      sessions
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
        .forEach((session, index) => {
          const root = candidates[index];
          if (root) owned.add(root.pid);
          rows.push({
            kind: "session",
            id: session.id,
            name: session.name,
            cwd: session.cwd,
            ...(root
              ? measure(tree(root))
              : { rssBytes: 0, cpuPercent: null, processes: 0, names: [] }),
          });
        });
    }

    const uptime = await proc.uptimeSec();
    const orphans: ResourceOrphan[] = [];
    for (const root of roots) {
      if (owned.has(root.pid)) continue;
      const ageSec = Math.max(0, Math.round(uptime - root.startTicks / proc.ticksPerSecond));
      if (ageSec < ORPHAN_MIN_AGE_SEC) continue;
      orphans.push({
        pid: root.pid,
        name: root.name,
        rssBytes: tree(root).reduce((sum, n) => sum + n.rssPages * proc.pageSize, 0),
        ageSec,
        startTicks: 0,
      });
    }

    this.samples = new Map(
      [...stats.values()].map((stat) => [stat.pid, { ticks: stat.cpuTicks, at }]),
    );
    return { ...base, measured: true, reason: null, rows, orphans };
  }

  /** Ends one orphan after looking again: it must still be one, and the daemon's own child. */
  async endOrphan(pid: number, _startTicks: number): Promise<void> {
    const { orphans } = await this.snapshot();
    if (!orphans.some((orphan) => orphan.pid === pid)) {
      throw new FlightdeckError(
        "invalid_state",
        "that process is not an orphan of this daemon",
        "not_orphan",
      );
    }
    this.opts.kill(pid);
  }
}
