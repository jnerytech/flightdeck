import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { inSequence } from "@flightdeck/protocol";
import { z } from "zod";
import { parseJsonOr } from "../kernel/index.ts";
import { isEntry, type LedgerEntry, parseStat } from "./domain/process-ledger.ts";

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

type Awaitable<T> = T | Promise<T>;

/** The part of the OS the ledger reads, injected so a test needs no real process. */
export interface ProcSource {
  identity(pid: number): Awaitable<ProcIdentity | null>;
  /** The processes whose group is `pgid`. */
  members(pgid: number): Awaitable<Array<{ pid: number; startTicks: number }>>;
  /** This boot's id (`/proc/sys/kernel/random/boot_id`): start ticks mean nothing across boots. */
  bootId(): Awaitable<string | null>;
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
 * Linux guarantees that a pid is not reused while a process group of that id has members. The
 * file is read and written without blocking, one change at a time, so two sessions starting at
 * once cannot lose an entry.
 */
export class ProcessLedger {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: LedgerOptions) {}

  /** Runs `work` after every change asked before it. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    // `then(work, work)`: a change that failed does not stop the next one.
    const run = this.queue.then(work, work);
    this.queue = run;
    return run;
  }

  private async read(): Promise<LedgerEntry[]> {
    try {
      const parsed = parseJsonOr(z.array(z.unknown()), await readFile(this.opts.file, "utf8"), []);
      return parsed.filter(isEntry);
    } catch {
      return [];
    }
  }

  private async write(entries: LedgerEntry[]): Promise<void> {
    try {
      await mkdir(dirname(this.opts.file), { recursive: true });
      const tmp = `${this.opts.file}.tmp`;
      await writeFile(tmp, JSON.stringify(entries));
      await rename(tmp, this.opts.file);
    } catch {
      // A ledger that cannot be written only loses the cleanup after a crash; it never stops a session.
    }
  }

  /** Writes down a process group the daemon just started, led by `pid`. */
  add(pid: number): Promise<void> {
    return this.serial(async () => {
      const identity = await this.opts.proc.identity(pid);
      const bootId = await this.opts.proc.bootId();
      if (!identity || !bootId) return;
      const entries = (await this.read()).filter((e) => e.pid !== pid);
      entries.push({ pid, startTicks: identity.startTicks, cmdline: identity.cmdline, bootId });
      await this.write(entries);
    });
  }

  /** The group's leader ended: whatever is left of its group is killed, and the entry goes. */
  release(pid: number): Promise<void> {
    return this.serial(async () => {
      const entries = await this.read();
      const entry = entries.find((e) => e.pid === pid);
      if (!entry) return;
      await this.settle(entry);
      await this.write(entries.filter((e) => e.pid !== pid));
    });
  }

  /** At start: kills the groups an earlier daemon left behind that are still alive. */
  reap(): Promise<ReapResult> {
    return this.serial(async () => {
      const entries = await this.read();
      const result: ReapResult = { reaped: [], stale: [] };
      // One group at a time: each look and signal sees the effect of the one before.
      await inSequence(entries, async (entry) => {
        ((await this.settle(entry)) ? result.reaped : result.stale).push(entry.pid);
      });
      if (entries.length > 0) await this.write([]);
      return result;
    });
  }

  /** How many groups are written down. */
  count(): Promise<number> {
    return this.serial(async () => (await this.read()).length);
  }

  /** Kills the group of an entry when it is still its own; whether it did. */
  private async settle(entry: LedgerEntry): Promise<boolean> {
    const { proc } = this.opts;
    if (entry.bootId !== (await proc.bootId())) return false;
    // Never the daemon itself or the group it runs in, whatever the file says.
    const own = await proc.identity(process.pid);
    if (entry.pid === process.pid || entry.pid === own?.pgrp) return false;
    const leader = await proc.identity(entry.pid);
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
      alive = (await proc.members(entry.pid)).some((m) => m.startTicks >= entry.startTicks);
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

/** /proc on Linux, read without blocking; on any other system nothing is known, so nothing is
 * recorded or reaped. */
export function procSource(
  platform: NodeJS.Platform = process.platform,
  root = "/proc",
): ProcSource {
  if (platform !== "linux") return { identity: () => null, members: () => [], bootId: () => null };
  const text = (path: string) => readFile(path, "utf8").catch(() => null);
  const stat = async (pid: number) => {
    const raw = await text(`${root}/${pid}/stat`);
    return raw === null ? null : parseStat(raw);
  };
  return {
    async bootId() {
      return (await text(`${root}/sys/kernel/random/boot_id`))?.trim() || null;
    },
    async identity(pid) {
      const parsed = await stat(pid);
      const raw = parsed ? await text(`${root}/${pid}/cmdline`) : null;
      if (!parsed || raw === null) return null;
      return { ...parsed, cmdline: raw.replaceAll("\0", " ").trim() };
    },
    async members(pgid) {
      const names = await readdir(root).catch(() => [] as string[]);
      const pids = names.filter((n) => /^\d+$/.test(n)).map(Number);
      const stats = await Promise.all(pids.map(async (pid) => ({ pid, parsed: await stat(pid) })));
      return stats.flatMap(({ pid, parsed }) =>
        parsed?.pgrp === pgid ? [{ pid, startTicks: parsed.startTicks }] : [],
      );
    },
  };
}
