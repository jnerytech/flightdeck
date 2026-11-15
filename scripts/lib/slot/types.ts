/** The types of the slot: the lock file's holder, the effects `SlotEnv` brings in, and the parsed command line. */

/** Who holds the slot, as written in the lock file. */
export interface SlotHolder {
  pid: number;
  label: string;
  command: string;
  startedAt: number;
}

interface SlotFs {
  /** Creates the file with all its content in one atomic step; false when it already exists. */
  create(path: string, data: string): boolean;
  read(path: string): string | null;
  remove(path: string): void;
  /** Every existing file whose path starts with the prefix. */
  list(prefix: string): string[];
}

export interface SlotChild {
  wait(): Promise<number>;
  kill(): void;
}

/** One process of the user, as the process list shows it. */
export interface ProcessInfo {
  pid: number;
  ppid: number;
  /** The niceness now: 0 is normal, 19 is the lowest priority. */
  nice: number;
  /** The command line, program first. */
  command: string;
}

export interface SlotEnv {
  fs: SlotFs;
  path: string;
  pid: number;
  label: string;
  alive(pid: number): boolean;
  now(): number;
  sleep(ms: number): Promise<void>;
  log(line: string): void;
  /**
   * Starts the command. `asHolder` marks the child as running under this process's lock, so a slot
   * call it makes itself runs at once (see `holder`).
   */
  spawn(command: string[], nice: boolean, asHolder?: boolean): SlotChild;
  /** Makes this process, and so the command it starts, the OOM killer's first choice (#247). */
  protect?(): void;
  /** The pid named by `FLIGHTDECK_SLOT_HOLDER` in this process's environment, if any. */
  holder?: number;
  /** Asks a process to stop (SIGTERM). */
  terminate(pid: number): void;
  /** The user's processes; absent where the platform cannot list them (no renicing then). */
  processes?(): Promise<ProcessInfo[]>;
  /** Sets the niceness of a process; the caller only ever raises it. */
  renice?(pid: number, nice: number): void;
  /** Calls the handler with the exit code of SIGINT or SIGTERM; returns the way to stop listening. */
  onSignal(handler: (code: number) => void): () => void;
  /** Reads the process table (/proc on Linux); absent elsewhere, where ancestry and orphans are not checked. */
  proc?: ProcReader;
  /** Stops a whole process group (SIGTERM to -pgid), for `--reap`. */
  terminateGroup?(pgid: number): void;
  /**
   * FLIGHTDECK_SLOT_DETACHED=1: the run was detached on purpose (nohup, setsid, a launcher that
   * exits at once), so a gone parent does not make it give up its place (#236).
   */
  detached?: boolean;
  /** FLIGHTDECK_SLOT_HEAVY in this process's environment: the reason a run over the file limit gives (#833). */
  heavyReason?: string;
  /** #1541: each test file's CI seconds (scripts/test-timings.json); the limit is then time, not files. */
  timings?: Record<string, number>;
  /** The checkout the timings' paths are relative to. */
  root?: string;
  /** Appends a refusal, a waiver or a long hold to the hook log, for harness:stats (#833). */
  record?(
    rule: "slot-files" | "long-hold",
    decision: "allow" | "block" | "waived",
    extra: { detail?: string; minutes?: number },
  ): void;
  /** Calls `fn` once after `ms`; returns the way to cancel it (#833: the holder's LONG line). */
  after?(ms: number, fn: () => void): () => void;
}

export interface ProcReader {
  /** The parent of a process, or null when it is gone. */
  ppid(pid: number): number | null;
  /** The process group of a process, or null when it is gone. */
  pgid(pid: number): number | null;
  /** The working folder of a process, or null when it cannot be read. */
  cwd(pid: number): string | null;
  /** The arguments of a process, program first; empty when they cannot be read. */
  cmdline(pid: number): string[];
  /** Every live process of a process group. */
  group(pgid: number): number[];
}

export type SlotArgs =
  | { kind: "status"; maxAgeMs: number }
  | { kind: "run"; nice: boolean; priority?: true; maxAgeMs: number; command: string[] }
  | { kind: "cancel" }
  | { kind: "reap" }
  | { kind: "usage" };

export type Attempt = { acquired: boolean; holder: SlotHolder | null };
