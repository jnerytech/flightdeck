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
  /** When it was last touched: for a session that is over, about when its process should have ended. */
  updatedAt: string;
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

/**
 * A process counts as a session's when it started this long before the session was created or after
 * it was last touched: clocks of the two readings are not the same one.
 */
const SESSION_SLACK_MS = 10_000;

/** A snapshot is shared for this long, which also steadies the CPU window between readers. */
const CACHE_MS = 1500;

/** How many processes are read at once: the machine's whole process list is never opened in one go. */
const BATCH = 32;

/** A process names itself, so its name is cleaned of control characters and cut. */
const MAX_NAME = 32;
const cleanName = (name: string) =>
  [...name]
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join("")
    .slice(0, MAX_NAME);

/** A folder removed under a running process reads `<path> (deleted)`: it is still that session's. */
const sameFolder = (cwd: string) => cwd.replace(/ \(deleted\)$/, "");

interface Sample {
  ticks: number;
  at: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export class Resources {
  private readonly now: () => number;
  /** CPU time of each process at the last shared snapshot: the only state, and no timer. */
  private samples = new Map<number, Sample>();
  private cached: { snapshot: ResourcesSnapshot; at: number } | null = null;
  private inFlight: Promise<ResourcesSnapshot> | null = null;

  constructor(private readonly opts: ResourcesOptions) {
    this.now = opts.now ?? Date.now;
  }

  /**
   * The host's resources: one read shared by whoever asks while it runs and kept for a moment, so
   * many callers cost one walk of the process list and the CPU window is the same for all.
   */
  snapshot(): Promise<ResourcesSnapshot> {
    if (this.cached && this.now() - this.cached.at < CACHE_MS) {
      return Promise.resolve(this.cached.snapshot);
    }
    if (this.inFlight) return this.inFlight;
    const reading = this.read(true).then(
      (snapshot) => {
        this.cached = { snapshot, at: this.now() };
        this.inFlight = null;
        return snapshot;
      },
      (error) => {
        this.inFlight = null;
        throw error;
      },
    );
    this.inFlight = reading;
    return reading;
  }

  /** One walk of the machine. Only the shared snapshot keeps the CPU samples. */
  private async read(keepSamples: boolean): Promise<ResourcesSnapshot> {
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
    const pids = await proc.pids();
    for (let from = 0; from < pids.length; from += BATCH) {
      const batch = await Promise.all(pids.slice(from, from + BATCH).map((pid) => proc.stat(pid)));
      for (const stat of batch) if (stat) stats.set(stat.pid, stat);
    }
    const children = new Map<number, ProcStat[]>();
    for (const stat of stats.values()) {
      const siblings = children.get(stat.ppid);
      if (siblings) siblings.push(stat);
      else children.set(stat.ppid, [stat]);
    }
    // A pid reused during the scan can make the parents loop: every process is visited once.
    const tree = (root: ProcStat): ProcStat[] => {
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
        names: [...new Set(nodes.map((n) => cleanName(n.name)))],
      };
    };
    const empty = { rssBytes: 0, cpuPercent: null, processes: 0, names: [] as string[] };

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
        ...(root ? measure(tree(root)) : empty),
      });
    }

    // The session programs the daemon started, by folder, in the order they started. One whose
    // folder cannot be read is left out of everything: nothing can be said of whose it is.
    const roots = (children.get(this.opts.ownPid) ?? []).filter(
      (stat) => SESSION_PROGRAMS.has(stat.name) && !terminalPids.has(stat.pid),
    );
    const byCwd = new Map<string, ProcStat[]>();
    for (const root of roots) {
      const cwd = await proc.cwd(root.pid);
      if (cwd === null) continue;
      const folder = sameFolder(cwd);
      byCwd.set(
        folder,
        [...(byCwd.get(folder) ?? []), root].sort((a, b) => a.startTicks - b.startTicks),
      );
    }
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
          rows.push({
            kind: "session",
            id: session.id,
            name: session.name,
            cwd: session.cwd,
            ...(root ? measure(tree(root)) : empty),
          });
        });
    }

    const uptime = await proc.uptimeSec();
    const orphans: ResourceOrphan[] = [];
    // Positive evidence only: the sessions that are over, by folder. A claude is a leftover when it
    // started during the life of one of them in its folder; a plugin, account or action `claude`,
    // or a live session's process whose folder moved, matches none.
    const overByCwd = new Map<string, ResourceSession[]>();
    for (const session of this.opts.sessions().filter((s) => !s.active)) {
      overByCwd.set(session.cwd, [...(overByCwd.get(session.cwd) ?? []), session]);
    }
    // A daemon that is pid 1 (a container) has every stray as a child: it lists none.
    if (this.opts.ownPid !== 1) {
      for (const [folder, candidates] of byCwd) {
        // Where an active session lives, which process is whose cannot be told: none is an orphan.
        if (sessionsByCwd.has(folder)) continue;
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
    }

    if (keepSamples) {
      this.samples = new Map(
        [...stats.values()].map((stat) => [stat.pid, { ticks: stat.cpuTicks, at }]),
      );
    }
    return { ...base, measured: true, reason: null, rows, orphans };
  }

  /**
   * Ends one orphan: the very process that was shown (pid and start), looked at again right
   * before the signal, still the daemon's own `claude` child and still nobody's. Reads on its own,
   * without touching the CPU window of the shared snapshot. A process already gone is ended.
   */
  async endOrphan(pid: number, startTicks: number): Promise<void> {
    const { orphans } = await this.read(false);
    const refuse = () =>
      new FlightdeckError(
        "invalid_state",
        "that process is not an orphan of this daemon",
        "not_orphan",
      );
    const listed = orphans.find((o) => o.pid === pid && o.startTicks === startTicks);
    if (!listed || !this.opts.proc) throw refuse();
    const again = await this.opts.proc.stat(pid);
    if (
      !again ||
      again.startTicks !== startTicks ||
      again.ppid !== this.opts.ownPid ||
      cleanName(again.name) !== listed.name
    ) {
      throw refuse();
    }
    try {
      this.opts.kill(pid);
    } catch (error) {
      if ((error as { code?: string }).code !== "ESRCH") throw error;
    }
  }
}
