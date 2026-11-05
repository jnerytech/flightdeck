/**
 * The full-gate slot: one exclusive lock for the heavy commands (full suite, e2e, shots, smokes,
 * builds), so two sessions never run them at once. Every effect (files, clock, processes) comes
 * in through `SlotEnv`, so the tests run nothing real and wait for nothing.
 */

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
}

export type SlotArgs =
  | { kind: "status"; maxAgeMs: number }
  | { kind: "run"; nice: boolean; priority?: true; maxAgeMs: number; command: string[] }
  | { kind: "cancel" }
  | { kind: "usage" };

export type Attempt = { acquired: boolean; holder: SlotHolder | null };

export const POLL_MS = 2000;
/** How often a `--priority` run lowers the other test processes. */
export const RENICE_MS = 5000;
/** The niceness the other sessions' test processes are raised to. */
export const NICE_OTHERS = 15;
/** A holder older than this is reported as suspicious (never taken over). */
export const DEFAULT_MAX_AGE_MS = 90 * 60_000;
export const USAGE =
  "usage: bun run slot -- [--nice] [--priority] <command...> | bun run slot -- --status | bun run slot -- --cancel";

interface SlotFlags {
  nice: boolean;
  priority: boolean;
  asStatus: boolean;
  asCancel: boolean;
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
    maxAgeMs: DEFAULT_MAX_AGE_MS,
    rest: argv[0] === "--" ? argv.slice(1) : argv,
  };
  for (;;) {
    const flag = flags.rest[0];
    if (flag === "--nice") flags.nice = true;
    else if (flag === "--priority") flags.priority = true;
    else if (flag === "--status") flags.asStatus = true;
    else if (flag === "--cancel") flags.asCancel = true;
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

export function parseArgs(argv: string[]): SlotArgs {
  const flags = readFlags(argv);
  if (!flags) return { kind: "usage" };
  const { nice, priority, asStatus, asCancel, maxAgeMs, rest } = flags;
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

export function describeHolder(holder: SlotHolder, now: number): string {
  const seconds = Math.max(0, Math.floor((now - holder.startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  let held = `${seconds}s`;
  if (minutes >= 60) held = `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  else if (minutes > 0) held = `${minutes}m ${seconds % 60}s`;
  return `${holder.label}: ${holder.command} (pid ${holder.pid}, ${held})`;
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
  env.fs.remove(waiting);
  env.fs.create(
    waiting,
    JSON.stringify({
      pid: env.pid,
      label: env.label,
      command,
      startedAt: env.now(),
    } satisfies SlotHolder),
  );
  try {
    return await waitForSlot(env, command, stopped, maxAgeMs);
  } finally {
    env.fs.remove(waiting);
  }
}

/** Waits for the slot, naming each new holder once. */
async function waitForSlot(
  env: SlotEnv,
  command: string,
  stopped: () => boolean,
  maxAgeMs: number,
): Promise<boolean> {
  let named = "";
  while (!stopped()) {
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

/** Gives the slot back, only if this process holds it. */
export function release(env: SlotEnv): void {
  if (parseHolder(env.fs.read(env.path))?.pid === env.pid) env.fs.remove(env.path);
}

export function status(env: SlotEnv, maxAgeMs = DEFAULT_MAX_AGE_MS): string {
  const text = env.fs.read(env.path);
  if (text === null) return "free";
  const holder = parseHolder(text);
  if (!holder) return "free (stale lock)";
  if (!env.alive(holder.pid)) return `free (stale lock of pid ${holder.pid})`;
  const held = `held by ${describeHolder(holder, env.now())}`;
  if (env.now() - holder.startedAt <= maxAgeMs) return held;
  return `${held}; WARNING: older than ${Math.floor(maxAgeMs / 60_000)}m, check if it is stuck`;
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
  if (args.kind === "status") {
    env.log(status(env, args.maxAgeMs));
    return 0;
  }
  const state: { signal: number | null; child: SlotChild | null } = { signal: null, child: null };
  const stopListening = env.onSignal((code) => {
    state.signal = code;
    state.child?.kill();
  });
  try {
    // A command the slot started that asks for the slot again (the test runner does above 60
    // files) would wait for the lock its own parent holds, forever: it runs at once instead.
    if (underHolder(env)) {
      state.child = env.spawn(args.command, args.nice, false);
      const code = await state.child.wait();
      return state.signal ?? code;
    }
    if (!(await acquire(env, args.command.join(" "), () => state.signal !== null, args.maxAgeMs))) {
      return state.signal ?? 1;
    }
    try {
      state.child = env.spawn(args.command, args.nice, true);
      const finished = { done: false };
      const lowering = args.priority ? lowerWhile(env, finished) : Promise.resolve();
      const code = await state.child.wait();
      finished.done = true;
      await lowering;
      return state.signal ?? code;
    } finally {
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
