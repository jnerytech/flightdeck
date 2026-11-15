import type { ResourceRow, ResourcesSnapshot } from "@flightdeck/protocol";
import { FlightdeckError } from "../kernel/index.ts";
import {
  childrenOf,
  cleanName,
  findOrphans,
  measureNodes,
  type ProcReader,
  type ProcStat,
  type ResourceSession,
  sameFolder,
  treeOf,
} from "./domain/proc-tree.ts";

export type { ProcReader, ProcStat, ResourceSession } from "./domain/proc-tree.ts";

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

/** The programs the daemon starts for a session; only these are ever called orphans. */
const SESSION_PROGRAMS = new Set(["claude"]);

/** A snapshot is shared for this long, which also steadies the CPU window between readers. */
const CACHE_MS = 1500;

/** How many processes are read at once: the machine's whole process list is never opened in one go. */
const BATCH = 32;

interface Sample {
  ticks: number;
  at: number;
}

/** Every process that could be read, by pid, asked for in batches. */
async function readStats(proc: ProcReader): Promise<Map<number, ProcStat>> {
  const stats = new Map<number, ProcStat>();
  const pids = await proc.pids();
  for (let from = 0; from < pids.length; from += BATCH) {
    const batch = await Promise.all(pids.slice(from, from + BATCH).map((pid) => proc.stat(pid))); // NOSONAR: sequential by design: one batch at a time, so a busy machine is not asked for every pid at once
    for (const stat of batch) if (stat) stats.set(stat.pid, stat);
  }
  return stats;
}

/** The roots by the folder they run in, in the order they started; one whose folder is unknown is left out. */
async function rootsByFolder(
  roots: ProcStat[],
  proc: ProcReader,
): Promise<Map<string, ProcStat[]>> {
  const byCwd = new Map<string, ProcStat[]>();
  for (const root of roots) {
    const cwd = await proc.cwd(root.pid); // NOSONAR: sequential by design: one /proc read at a time; the roots are few
    if (cwd === null) continue;
    const folder = sameFolder(cwd);
    byCwd.set(
      folder,
      [...(byCwd.get(folder) ?? []), root].sort((a, b) => a.startTicks - b.startTicks),
    );
  }
  return byCwd;
}

/** Adds `value` to the list under `key`. */
function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}

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
    const stats = await readStats(proc);
    const children = childrenOf(stats);
    const tree = (root: ProcStat) => treeOf(children, root);
    const measure = (nodes: ProcStat[]) => measureNodes(nodes, this.samples, at, proc);
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
    const byCwd = await rootsByFolder(roots, proc);
    const active = this.opts.sessions().filter((s) => s.active);
    const sessionsByCwd = new Map<string, ResourceSession[]>();
    for (const session of active) push(sessionsByCwd, session.cwd, session);
    for (const [cwd, sessions] of sessionsByCwd) {
      const candidates = byCwd.get(cwd) ?? [];
      sessions.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      sessions.forEach((session, index) => {
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
    // Positive evidence only: the sessions that are over, by folder. A claude is a leftover when it
    // started during the life of one of them in its folder; a plugin, account or action `claude`,
    // or a live session's process whose folder moved, matches none.
    const overByCwd = new Map<string, ResourceSession[]>();
    for (const session of this.opts.sessions().filter((s) => !s.active)) {
      push(overByCwd, session.cwd, session);
    }
    // A daemon that is pid 1 (a container) has every stray as a child: it lists none.
    const orphans =
      this.opts.ownPid === 1
        ? []
        : findOrphans({ byCwd, taken: sessionsByCwd, overByCwd, uptime, at, proc, tree });

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
      again?.startTicks !== startTicks ||
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
