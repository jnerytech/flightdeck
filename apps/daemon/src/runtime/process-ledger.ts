/**
 * A ledger of the process groups the daemon starts for OpenCode (issue #250). After a SIGKILL of
 * the daemon, `opencode acp` exits when its pipe closes, but a command it was running survives in
 * the same group. The next start reaps what is left, checking who it is first.
 */

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

/** The fields of /proc/<pid>/stat that matter: the group and the start time. */
export function parseStat(_text: string): { pgrp: number; startTicks: number } | null {
  return null;
}

export class ProcessLedger {
  constructor(private readonly opts: LedgerOptions) {}

  /** Writes down a process group the daemon just started, led by `pid`. */
  add(_pid: number): void {}

  /** The group's leader ended: whatever is left of its group is killed, and the entry goes. */
  release(_pid: number): void {}

  /** At start: kills the groups an earlier daemon left behind that are still alive. */
  reap(): ReapResult {
    return { reaped: [], stale: [] };
  }

  get size(): number {
    return -1;
  }
}

/** /proc on Linux; on any other system nothing is known, so nothing is recorded or reaped. */
export function procSource(_platform: NodeJS.Platform = process.platform): ProcSource {
  return { identity: () => null, members: () => [] };
}
