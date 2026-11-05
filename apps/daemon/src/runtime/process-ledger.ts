import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * A ledger of the process groups the daemon starts for OpenCode (issue #250). After a SIGKILL of
 * the daemon, `opencode acp` exits when its pipe closes, but a command it was running survives in
 * the same group. The next start reaps what is left, checking who it is first.
 */

/** The ledger's file name, in the daemon's data folder. */
export const OPENCODE_LEDGER_FILE = "opencode-groups.json";

/** What /proc says of a process. */
export interface ProcIdentity {
  /** Clock ticks after boot at which it started: with the pid, a process's identity. */
  startTicks: number;
  cmdline: string;
  /** The process group it belongs to. */
  pgrp: number;
}

/** The part of the OS the ledger reads, injected so a test needs no real process. */
export interface ProcSource {
  identity(pid: number): ProcIdentity | null;
  /** The processes whose group is `pgid`. */
  members(pgid: number): Array<{ pid: number; startTicks: number }>;
}

export interface LedgerEntry {
  pid: number;
  startTicks: number;
  cmdline: string;
}

export interface LedgerOptions {
  /** The file the entries are kept in. */
  file: string;
  proc: ProcSource;
  killGroup: (pgid: number, signal: NodeJS.Signals) => void;
}

export interface ReapResult {
  /** The groups killed. */
  reaped: number[];
  /** The entries whose group was already gone or whose pid someone else holds now. */
  stale: number[];
}

/**
 * The fields of /proc/<pid>/stat that matter. The command is in parentheses and may hold spaces
 * and parentheses of its own, so the fields are counted from the last `)`: group is the 3rd after
 * it, the start time the 20th.
 */
export function parseStat(text: string): { pgrp: number; startTicks: number } | null {
  const rest = text.slice(text.lastIndexOf(")") + 1).trim();
  if (!rest || text.lastIndexOf(")") < 0) return null;
  const fields = rest.split(/\s+/);
  const pgrp = Number(fields[2]);
  const startTicks = Number(fields[19]);
  return Number.isInteger(pgrp) && Number.isInteger(startTicks) ? { pgrp, startTicks } : null;
}

const isEntry = (value: unknown): value is LedgerEntry => {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return Number.isInteger(e.pid) && Number.isFinite(e.startTicks) && typeof e.cmdline === "string";
};

/** Linux guarantees that a pid is not reused while a process group of that id has members. */
export class ProcessLedger {
  constructor(private readonly opts: LedgerOptions) {}

  private read(): LedgerEntry[] {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.opts.file, "utf8"));
      return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
    } catch {
      return [];
    }
  }

  private write(entries: LedgerEntry[]): void {
    try {
      mkdirSync(dirname(this.opts.file), { recursive: true });
      const tmp = `${this.opts.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(entries));
      renameSync(tmp, this.opts.file);
    } catch {
      // A ledger that cannot be written only loses the cleanup after a crash; it never stops a session.
    }
  }

  /** Writes down a process group the daemon just started, led by `pid`. */
  add(pid: number): void {
    const identity = this.opts.proc.identity(pid);
    if (!identity) return;
    const entries = this.read().filter((e) => e.pid !== pid);
    entries.push({ pid, startTicks: identity.startTicks, cmdline: identity.cmdline });
    this.write(entries);
  }

  /** The group's leader ended: whatever is left of its group is killed, and the entry goes. */
  release(pid: number): void {
    const entries = this.read();
    const entry = entries.find((e) => e.pid === pid);
    if (!entry) return;
    this.settle(entry);
    this.write(entries.filter((e) => e.pid !== pid));
  }

  /** At start: kills the groups an earlier daemon left behind that are still alive. */
  reap(): ReapResult {
    const entries = this.read();
    const result: ReapResult = { reaped: [], stale: [] };
    for (const entry of entries) {
      (this.settle(entry) ? result.reaped : result.stale).push(entry.pid);
    }
    if (entries.length > 0) this.write([]);
    return result;
  }

  get size(): number {
    return this.read().length;
  }

  /** Kills the group of an entry when it is still its own; whether it did. */
  private settle(entry: LedgerEntry): boolean {
    const { proc } = this.opts;
    const leader = proc.identity(entry.pid);
    let alive: boolean;
    if (leader) {
      // The pid is there: it is ours only if it started when and as it did, leading its own group.
      alive =
        leader.startTicks === entry.startTicks &&
        leader.cmdline === entry.cmdline &&
        leader.pgrp === entry.pid;
    } else {
      // The leader is gone. While any process holds the group id, the kernel does not hand the pid
      // to another: what belongs to the group and started after the leader is what it left behind.
      alive = proc.members(entry.pid).some((m) => m.startTicks >= entry.startTicks);
    }
    if (!alive) return false;
    try {
      this.opts.killGroup(entry.pid, "SIGKILL");
    } catch {
      // Gone between the look and the signal: nothing left to kill.
    }
    return true;
  }
}

/** /proc on Linux; on any other system nothing is known, so nothing is recorded or reaped. */
export function procSource(platform: NodeJS.Platform = process.platform): ProcSource {
  if (platform !== "linux") return { identity: () => null, members: () => [] };
  const stat = (pid: number) => {
    try {
      return parseStat(readFileSync(`/proc/${pid}/stat`, "utf8"));
    } catch {
      return null;
    }
  };
  return {
    identity(pid) {
      const parsed = stat(pid);
      if (!parsed) return null;
      try {
        const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ").trim();
        return { ...parsed, cmdline };
      } catch {
        return null;
      }
    },
    members(pgid) {
      const found: Array<{ pid: number; startTicks: number }> = [];
      let names: string[];
      try {
        names = readdirSync("/proc");
      } catch {
        return found;
      }
      for (const name of names) {
        if (!/^\d+$/.test(name)) continue;
        const parsed = stat(Number(name));
        if (parsed && parsed.pgrp === pgid) {
          found.push({ pid: Number(name), startTicks: parsed.startTicks });
        }
      }
      return found;
    },
  };
}
