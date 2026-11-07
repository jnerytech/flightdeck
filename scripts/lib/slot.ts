/**
 * The full-gate slot: one exclusive lock for the heavy commands (full suite, e2e, shots, smokes,
 * builds), so two sessions never run them at once. Every effect (files, clock, processes) comes
 * in through `SlotEnv`, so the tests run nothing real and wait for nothing.
 */
import { heavyReasonGiven } from "./slot-heavy.ts";

/** Who holds the slot, as written in the lock file. */
export interface SlotHolder {
  pid: number;
  label: string;
  command: string;
  startedAt: number;
}

export interface SlotFs {
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

/** A slot process: bun or node running scripts/slot.ts, not a program that only names the file. */
function isSlotProcess(argv: string[]): boolean {
  const program = (argv[0] ?? "")
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.exe$/, "");
  if (program !== "bun" && program !== "node") return false;
  return argv.slice(1, 3).some((arg) => /(?:^|[\\/])scripts[\\/]slot\.ts$/.test(arg));
}

/** Text from a lock or waiter file, or from /proc, kept to one plain line: control characters become spaces. */
function oneLine(text: string): string {
  // C1 too (#833 review): U+009B is CSI on the terminals that honor it.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ");
}

export type SlotArgs =
  | { kind: "status"; maxAgeMs: number }
  | { kind: "run"; nice: boolean; priority?: true; maxAgeMs: number; command: string[] }
  | { kind: "cancel" }
  | { kind: "reap" }
  | { kind: "usage" };

export type Attempt = { acquired: boolean; holder: SlotHolder | null };

export const POLL_MS = 2000;
/** How often a `--priority` run lowers the other test processes. */
export const RENICE_MS = 5000;
/** The niceness the other sessions' test processes are raised to. */
export const NICE_OTHERS = 15;
/** A holder older than this is reported as suspicious (never taken over). */
export const DEFAULT_MAX_AGE_MS = 90 * 60_000;
/** A hold past this is LONG: the holder, its waiters and `--status` say so, and the hook log keeps it (#833). */
export const LONG_HOLD_MS = 20 * 60_000;
/** The most test files a slot run may name without a reason (#833); `test:related` takes the slot above it. */
export const SLOT_TEST_FILES = 60;
export const USAGE =
  "usage: bun run slot -- [--nice] [--priority] <command...> | bun run slot -- --status | bun run slot -- --cancel | bun run slot -- --reap";

interface SlotFlags {
  nice: boolean;
  priority: boolean;
  asStatus: boolean;
  asCancel: boolean;
  asReap: boolean;
  maxAgeMs: number;
  rest: string[];
}

/** The leading `--flags` of the command line and what follows them; null when `--max-age` is bad. */
function readFlags(argv: string[]): SlotFlags | null {
  const flags: SlotFlags = {
    nice: false,
    priority: false,
    asStatus: false,
    asCancel: false,
    asReap: false,
    maxAgeMs: DEFAULT_MAX_AGE_MS,
    rest: argv[0] === "--" ? argv.slice(1) : argv,
  };
  for (;;) {
    const flag = flags.rest[0];
    if (flag === "--nice") flags.nice = true;
    else if (flag === "--priority") flags.priority = true;
    else if (flag === "--status") flags.asStatus = true;
    else if (flag === "--cancel") flags.asCancel = true;
    else if (flag === "--reap") flags.asReap = true;
    else if (flag === "--max-age") {
      const minutes = Number(flags.rest[1]);
      if (!flags.rest[1] || Number.isNaN(minutes) || minutes <= 0) return null;
      flags.maxAgeMs = minutes * 60_000;
      flags.rest = flags.rest.slice(1);
    } else break;
    flags.rest = flags.rest.slice(1);
  }
  return flags;
}

/**
 * The parent and the process group from a /proc/<pid>/stat line; null when it does not read. The
 * command name sits in parentheses and may hold spaces or parentheses itself, so the fields start
 * after the last ")".
 */
export function parseStat(text: string): { ppid: number; pgid: number } | null {
  const close = text.lastIndexOf(")");
  if (close < 0) return null;
  const [, ppid = "", pgid = ""] = text.slice(close + 2).split(" ");
  if (!/^\d+$/.test(ppid) || !/^\d+$/.test(pgid)) return null;
  return { ppid: Number(ppid), pgid: Number(pgid) };
}

export function parseArgs(argv: string[]): SlotArgs {
  const flags = readFlags(argv);
  if (!flags) return { kind: "usage" };
  const { nice, priority, asStatus, asCancel, asReap, maxAgeMs, rest } = flags;
  if (asReap) {
    return rest.length === 0 && !asStatus && !asCancel && !nice
      ? { kind: "reap" }
      : { kind: "usage" };
  }
  if (asCancel)
    return rest.length === 0 && !asStatus && !nice ? { kind: "cancel" } : { kind: "usage" };
  if (asStatus) return rest.length === 0 ? { kind: "status", maxAgeMs } : { kind: "usage" };
  if (rest.length === 0) return { kind: "usage" };
  return {
    kind: "run",
    nice,
    ...(priority ? { priority: true as const } : {}),
    maxAgeMs,
    command: rest,
  };
}

export function parseHolder(text: string | null): SlotHolder | null {
  if (!text) return null;
  let value: Partial<Record<keyof SlotHolder, unknown>>;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { pid, label, command, startedAt } = value;
  if (typeof pid !== "number" || typeof startedAt !== "number") return null;
  if (typeof label !== "string" || typeof command !== "string") return null;
  return { pid, label, command, startedAt };
}

/** A command of hundreds of test files, cut to one readable line (#236). */
function clip(command: string): string {
  return oneLine(command.length > 80 ? `${command.slice(0, 80)}…` : command);
}

export function describeHolder(holder: SlotHolder, now: number): string {
  const seconds = Math.max(0, Math.floor((now - holder.startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  let held = `${seconds}s`;
  if (minutes >= 60) held = `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  else if (minutes > 0) held = `${minutes}m ${seconds % 60}s`;
  // A holder or waiter of hundreds of test files stays one line (#236).
  return `${oneLine(holder.label)}: ${clip(holder.command)} (pid ${holder.pid}, ${held})`;
}

/**
 * One try at the lock. A lock whose process is dead, or that cannot be read, is stale and is
 * removed, but only if it is still the file that was judged stale (somebody else may have
 * cleaned it and taken the slot in between).
 */
export function tryAcquire(env: SlotEnv, command: string): Attempt {
  const mine = JSON.stringify({
    pid: env.pid,
    label: env.label,
    command,
    startedAt: env.now(),
  } satisfies SlotHolder);
  if (env.fs.create(env.path, mine)) return { acquired: true, holder: null };
  const text = env.fs.read(env.path);
  if (text === null) return { acquired: false, holder: null };
  const holder = parseHolder(text);
  if (holder && env.alive(holder.pid)) return { acquired: false, holder };
  const now = env.fs.read(env.path);
  if (now !== text) return { acquired: false, holder: parseHolder(now) };
  env.fs.remove(env.path);
  return { acquired: env.fs.create(env.path, mine), holder: null };
}

function waiterPath(env: SlotEnv, pid: number): string {
  return `${env.path}.wait.${pid}`;
}

/**
 * The live waiters, first come first: by the time they queued, then by pid (#372). Dead or
 * unreadable waiter files count for nothing, and a pid shows once (a waiter file being written
 * has a staging copy under the same prefix).
 */
export function waiters(env: SlotEnv): SlotHolder[] {
  const byPid = new Map<number, SlotHolder>();
  for (const path of env.fs.list(`${env.path}.wait.`)) {
    const waiter = parseHolder(env.fs.read(path));
    if (waiter && env.alive(waiter.pid)) byPid.set(waiter.pid, waiter);
  }
  return [...byPid.values()].sort((a, b) => a.startedAt - b.startedAt || a.pid - b.pid);
}

/** The live waiters that queued before `me`; the slot is only tried when there are none. */
function ahead(env: SlotEnv, me: { pid: number; startedAt: number }): SlotHolder[] {
  return waiters(env).filter(
    (w) => w.startedAt < me.startedAt || (w.startedAt === me.startedAt && w.pid < me.pid),
  );
}

/**
 * Waits for the slot while a waiter file says who is waiting (so `--cancel` can find it); false
 * when `stopped` ended the wait.
 */
export async function acquire(
  env: SlotEnv,
  command: string,
  stopped: () => boolean,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
): Promise<boolean> {
  const waiting = waiterPath(env, env.pid);
  const queuedAt = env.now();
  env.fs.remove(waiting);
  env.fs.create(
    waiting,
    JSON.stringify({
      pid: env.pid,
      label: env.label,
      command,
      startedAt: queuedAt,
    } satisfies SlotHolder),
  );
  try {
    return await waitForSlot(env, command, stopped, maxAgeMs, queuedAt);
  } finally {
    env.fs.remove(waiting);
  }
}

/**
 * Waits for the slot, naming each new holder once. Only the first live waiter tries the lock, so
 * the slot goes in queue order, not to whichever poll lands first after a release (#372).
 */
async function waitForSlot(
  env: SlotEnv,
  command: string,
  stopped: () => boolean,
  maxAgeMs: number,
  queuedAt: number,
): Promise<boolean> {
  let named = "";
  let queue = "";
  let warned = "";
  while (!stopped()) {
    warned = warnLong(env, maxAgeMs, warned);
    const before = ahead(env, { pid: env.pid, startedAt: queuedAt });
    const [first] = before;
    if (first) {
      if (`${before.length}@${first.pid}` !== queue) {
        queue = `${before.length}@${first.pid}`;
        env.log(
          `slot queue: ${before.length} waiting before you (first: ${describeHolder(first, env.now())}); waiting`,
        );
      }
      await env.sleep(POLL_MS); // NOSONAR: poll interval: the wait between looks is the point of this loop
      continue;
    }
    const attempt = tryAcquire(env, command);
    if (attempt.acquired) return true;
    const { holder } = attempt;
    if (holder && `${holder.pid}@${holder.startedAt}` !== named) {
      named = `${holder.pid}@${holder.startedAt}`;
      env.log(`slot busy: ${describeHolder(holder, env.now())}; waiting`);
      if (env.now() - holder.startedAt > maxAgeMs) {
        env.log(
          `slot warning: ${holder.label} (pid ${holder.pid}) has held the slot for over ${Math.floor(maxAgeMs / 60_000)}m: check if it is stuck; not taking it over`,
        );
      }
    }
    await env.sleep(POLL_MS); // NOSONAR: poll interval: the wait between looks is the point of this loop
  }
  return false;
}

/** The live holder of the slot, or null when it is free or its lock is stale. */
function liveHolder(env: SlotEnv): SlotHolder | null {
  const holder = parseHolder(env.fs.read(env.path));
  return holder && env.alive(holder.pid) ? holder : null;
}

/**
 * Tells a waiter once that the holder passed `LONG_HOLD_MS` (#833); past the max age the stronger
 * warning above says it instead. Returns the holder it has told about.
 */
function warnLong(env: SlotEnv, maxAgeMs: number, warned: string): string {
  const holder = liveHolder(env);
  if (!holder) return warned;
  const key = `${holder.pid}@${holder.startedAt}`;
  const age = env.now() - holder.startedAt;
  if (key === warned || age <= LONG_HOLD_MS || age > maxAgeMs) return warned;
  env.log(
    `slot warning: ${oneLine(holder.label)} (pid ${holder.pid}) has held the slot for over ${LONG_HOLD_MS / 60_000}m (LONG); waiting`,
  );
  return key;
}

/** Gives the slot back, only if this process holds it. */
export function release(env: SlotEnv): void {
  if (parseHolder(env.fs.read(env.path))?.pid === env.pid) env.fs.remove(env.path);
}

/** Who holds the slot, then each live waiter in queue order with how long it has waited. */
export function status(env: SlotEnv, maxAgeMs = DEFAULT_MAX_AGE_MS): string {
  const lines = [holderStatus(env, maxAgeMs)];
  const holder = liveHolder(env);
  // #833: who each waiter waits on, so a LONG holder is named on every line.
  const on = holder ? `; waits on ${oneLine(holder.label)} (pid ${holder.pid})` : "";
  waiters(env).forEach((waiter, index) => {
    // Where the process table can be read: the waiter's folder, and whether its shell is gone (#236).
    const where = env.proc ? ` in ${oneLine(env.proc.cwd(waiter.pid) ?? "?")}` : "";
    const orphan = env.proc?.ppid(waiter.pid) === 1 ? " ORPHAN" : "";
    lines.push(`waiting ${index + 1}: ${describeHolder(waiter, env.now())}${where}${orphan}${on}`);
  });
  return lines.join("\n");
}

function holderStatus(env: SlotEnv, maxAgeMs: number): string {
  const text = env.fs.read(env.path);
  if (text === null) return "free";
  const holder = parseHolder(text);
  if (!holder) return "free (stale lock)";
  if (!env.alive(holder.pid)) return `free (stale lock of pid ${holder.pid})`;
  const held = `held by ${describeHolder(holder, env.now())}`;
  const age = env.now() - holder.startedAt;
  if (age > maxAgeMs) {
    return `${held}; WARNING: older than ${Math.floor(maxAgeMs / 60_000)}m, check if it is stuck`;
  }
  return age > LONG_HOLD_MS ? `${held}; LONG: over ${LONG_HOLD_MS / 60_000}m` : held;
}

/**
 * Stops the waiters and the run of this label (never this process, never another label). The
 * wrapper that gets SIGTERM kills its command and gives the slot back. Waiter files of dead
 * processes or unreadable ones are cleaned up.
 */
export function cancel(env: SlotEnv): number {
  const entries = [env.path, ...env.fs.list(`${env.path}.wait.`)];
  let stopped = 0;
  for (const path of entries) {
    const holder = parseHolder(env.fs.read(path));
    if (!holder || !env.alive(holder.pid)) {
      if (path !== env.path) env.fs.remove(path);
      continue;
    }
    if (holder.label !== env.label || holder.pid === env.pid) continue;
    env.terminate(holder.pid);
    env.log(`cancelled ${describeHolder(holder, env.now())}`);
    stopped += 1;
  }
  if (stopped === 0) env.log(`nothing to cancel for ${env.label}`);
  return 0;
}

/**
 * Stops the waiters whose shell is gone (their parent is pid 1), by process group, and forgets
 * them; waiter files of dead processes are cleaned up. The holder is never touched (#236).
 */
export function reap(env: SlotEnv): number {
  let reaped = 0;
  // Two orphan waiters of one group are stopped by one signal to it.
  const stopped = new Set<number>();
  for (const path of env.fs.list(`${env.path}.wait.`)) {
    const waiter = parseHolder(env.fs.read(path));
    if (!waiter || !env.alive(waiter.pid)) {
      env.fs.remove(path);
      continue;
    }
    const group = env.proc ? reapableGroup(env, env.proc, path, waiter.pid) : null;
    if (group === null) continue;
    if (!stopped.has(group)) {
      stopped.add(group);
      if (env.terminateGroup) env.terminateGroup(group);
      else env.terminate(waiter.pid);
    }
    env.fs.remove(path);
    env.log(`reaped ${describeHolder(waiter, env.now())}`);
    reaped += 1;
  }
  if (reaped === 0) env.log("nothing to reap");
  return 0;
}

/**
 * The process group to stop for a waiter file, or null when it names no slot waiter that may be
 * stopped: the file's name carries its pid, the pid is above 1, its group, read once right before
 * the kill, is above 1 and not the reaper's own, and every member of that group is an orphan slot
 * process (parent pid 1, bun or node running scripts/slot.ts) other than the holder. So a group
 * shared with the holder, a shell or a live run is never stopped (#388 review).
 */
function reapableGroup(env: SlotEnv, proc: ProcReader, path: string, pid: number): number | null {
  if (!Number.isInteger(pid) || pid <= 1 || path !== waiterPath(env, pid)) return null;
  const group = proc.pgid(pid);
  if (group === null || group <= 1 || group === proc.pgid(env.pid)) return null;
  const holder = parseHolder(env.fs.read(env.path))?.pid;
  const members = proc.group(group);
  if (!members.includes(pid)) return null;
  const orphanWaiter = (member: number) =>
    member !== holder && proc.ppid(member) === 1 && isSlotProcess(proc.cmdline(member));
  return members.every(orphanWaiter) ? group : null;
}

/**
 * Whether a live process that holds the slot is an ancestor of this one: a nested call from a
 * holder whose children lost FLIGHTDECK_SLOT_HOLDER, or an older slot.ts that never set it (#236).
 * At most 64 steps, so a parent table that loops ends.
 */
function underAncestor(env: SlotEnv): boolean {
  const holder = parseHolder(env.fs.read(env.path));
  if (!holder || !env.alive(holder.pid) || !env.proc) return false;
  let pid = env.pid;
  for (let step = 0; step < 64; step++) {
    const parent = env.proc.ppid(pid);
    if (parent === null || parent <= 1) return false;
    if (parent === holder.pid) return true;
    pid = parent;
  }
  return false;
}

const ORPHANED =
  "slot: the shell that started this run is gone; giving up so the queue moves (rerun it if you still need it)";

/**
 * Whether this process was started by the process that holds the slot now: the variable names a
 * live pid, and the lock names the same one (a name left over from an old run is not enough).
 */
function underHolder(env: SlotEnv): boolean {
  const { holder } = env;
  if (holder === undefined || !env.alive(holder)) return false;
  return parseHolder(env.fs.read(env.path))?.pid === holder;
}

/** Runs the command under the slot and returns its exit code (a signal's code when one stopped it). */
export async function run(env: SlotEnv, argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.kind === "usage") {
    env.log(USAGE);
    return 2;
  }
  if (args.kind === "cancel") return cancel(env);
  if (args.kind === "reap") return reap(env);
  if (args.kind === "status") {
    // One log call per line: the real log keeps each call to one line (#372).
    for (const line of status(env, args.maxAgeMs).split("\n")) env.log(line);
    return 0;
  }
  // #833: before anything runs, nested or not: `slot -- bun run test:related` names its files only
  // in the nested call (#865 review).
  if (refusedOverLimit(env, args.command)) return 2;
  // Before anything is spawned, so the command and all it starts inherit the score.
  env.protect?.();
  const state: { signal: number | null; child: SlotChild | null } = { signal: null, child: null };
  const stopListening = env.onSignal((code) => {
    state.signal = code;
    state.child?.kill();
  });
  try {
    // A command the slot started that asks for the slot again (the test runner does above 60
    // files) would wait for the lock its own parent holds, forever: it runs at once instead.
    if (underHolder(env) || underAncestor(env)) {
      state.child = env.spawn(args.command, args.nice, false);
      const code = await state.child.wait();
      return state.signal ?? code;
    }
    // A waiter whose launching shell is gone would hold its place for nobody: it gives up (#236).
    const parent = env.proc?.ppid(env.pid) ?? null;
    const orphaned = () =>
      !env.detached &&
      parent !== null &&
      (parent === 1 || !env.alive(parent) || env.proc?.ppid(env.pid) !== parent);
    if (orphaned()) {
      env.log(ORPHANED);
      return 1;
    }
    const stopped = () => state.signal !== null || orphaned();
    if (!(await acquire(env, args.command.join(" "), stopped, args.maxAgeMs))) {
      if (state.signal === null) env.log(ORPHANED);
      return state.signal ?? 1;
    }
    const heldAt = env.now();
    const stopWarning = env.after?.(LONG_HOLD_MS, () =>
      env.log(
        `slot: this run has held the slot for over ${LONG_HOLD_MS / 60_000}m (LONG); ${waiters(env).length} waiting for it`,
      ),
    );
    try {
      state.child = env.spawn(args.command, args.nice, true);
      const finished = { done: false };
      const lowering = args.priority ? lowerWhile(env, finished) : Promise.resolve();
      const code = await state.child.wait();
      finished.done = true;
      await lowering;
      return state.signal ?? code;
    } finally {
      stopWarning?.();
      recordLongHold(env, heldAt, args.command.join(" "));
      release(env);
    }
  } finally {
    stopListening();
  }
}

/**
 * Raises the niceness of the other `bun test` processes of the user to `NICE_OTHERS`, so a gate
 * run with `--priority` gets the CPU. Only raises (a process already at or above it is left), skips
 * the slot's own process tree, and restores nothing. Returns the pids it changed.
 */
export async function lowerOthers(env: SlotEnv): Promise<number[]> {
  if (!env.processes || !env.renice) return [];
  const all = await env.processes();
  // The slot's own tree: this process and everything it started.
  const own = new Set([env.pid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of all) {
      if (!own.has(p.pid) && own.has(p.ppid)) {
        own.add(p.pid);
        grew = true;
      }
    }
  }
  const lowered: number[] = [];
  for (const p of all) {
    if (own.has(p.pid) || p.nice >= NICE_OTHERS || !isBunTest(p.command)) continue;
    env.renice(p.pid, NICE_OTHERS);
    lowered.push(p.pid);
  }
  return lowered;
}

/** How many test files a `bun ... test` command names; 0 for any other command (#833). */
export function testFileCount(command: string[]): number {
  if (!isBunTest(command.join(" "))) return 0;
  return command.filter((arg) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(arg)).length;
}

/**
 * #833: a run of more than `SLOT_TEST_FILES` test files holds the slot 20 minutes or more while
 * others wait, so it needs FLIGHTDECK_SLOT_HEAVY with a reason. The refusal and the waiver both go
 * to the hook log. True when the run is refused.
 */
function refusedOverLimit(env: SlotEnv, command: string[]): boolean {
  const count = testFileCount(command);
  if (count <= SLOT_TEST_FILES) return false;
  const reason = (env.heavyReason ?? "").trim();
  if (heavyReasonGiven(reason)) {
    env.record?.("slot-files", "waived", { detail: reason.slice(0, 200) });
    return false;
  }
  env.log(
    `slot: ${count} test files would hold the slot for 20 minutes or more while others wait; more than ${SLOT_TEST_FILES} need a reason (#833). Run fewer: each touched test with \`bun --config=bunfig.area.toml test <file>\`, or \`bun run test:related -- --fast --tier unit,component\` on a smaller change; CI runs the rest. For a real need, put FLIGHTDECK_SLOT_HEAVY="<reason>" in front of the command (of \`bun run test:related\` too).`,
  );
  env.record?.("slot-files", "block", {});
  return true;
}

/** #833: a hold past `LONG_HOLD_MS` goes to the hook log when the slot is given back. */
function recordLongHold(env: SlotEnv, heldAt: number, command: string): void {
  const held = env.now() - heldAt;
  if (held <= LONG_HOLD_MS) return;
  env.record?.("long-hold", "allow", {
    minutes: Math.floor(held / 60_000),
    detail: `${oneLine(env.label)}: ${clip(command)}`,
  });
}

/** `bun test ...`, `bun --config=x test ...` or a path to bun: its first plain argument is `test`. */
function isBunTest(command: string): boolean {
  const [program, ...args] = command.trim().split(/\s+/);
  if (
    !program ||
    program
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.exe$/, "") !== "bun"
  )
    return false;
  return args.find((arg) => !arg.startsWith("-")) === "test";
}

/** Lowers the others every `RENICE_MS` until the command is done; a failure only skips a pass. */
async function lowerWhile(env: SlotEnv, finished: { done: boolean }): Promise<void> {
  while (!finished.done) {
    try {
      await lowerOthers(env); // NOSONAR: sequential by design: each pass needs the answer of the one before
    } catch {
      // Listing or renicing is best effort: the run itself is not affected.
    }
    await env.sleep(RENICE_MS); // NOSONAR: poll interval: the wait between looks is the point of this loop
  }
}
