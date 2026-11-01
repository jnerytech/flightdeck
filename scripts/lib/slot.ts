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
}

export interface SlotChild {
  wait(): Promise<number>;
  kill(): void;
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
  spawn(command: string[], nice: boolean): SlotChild;
  /** Calls the handler with the exit code of SIGINT or SIGTERM; returns the way to stop listening. */
  onSignal(handler: (code: number) => void): () => void;
}

export type SlotArgs =
  | { kind: "status"; maxAgeMs: number }
  | { kind: "run"; nice: boolean; maxAgeMs: number; command: string[] }
  | { kind: "usage" };

export type Attempt = { acquired: boolean; holder: SlotHolder | null };

export const POLL_MS = 2000;
/** A holder older than this is reported as suspicious (never taken over). */
export const DEFAULT_MAX_AGE_MS = 90 * 60_000;
export const USAGE = "usage: bun run slot -- [--nice] <command...> | bun run slot -- --status";

export function parseArgs(argv: string[]): SlotArgs {
  let rest = argv[0] === "--" ? argv.slice(1) : argv;
  let nice = false;
  let asStatus = false;
  let maxAgeMs = DEFAULT_MAX_AGE_MS;
  for (;;) {
    const flag = rest[0];
    if (flag === "--nice") nice = true;
    else if (flag === "--status") asStatus = true;
    else if (flag === "--max-age") {
      const minutes = Number(rest[1]);
      if (!rest[1] || !(minutes > 0)) return { kind: "usage" };
      maxAgeMs = minutes * 60_000;
      rest = rest.slice(1);
    } else break;
    rest = rest.slice(1);
  }
  if (asStatus) return rest.length === 0 ? { kind: "status", maxAgeMs } : { kind: "usage" };
  return rest.length > 0 ? { kind: "run", nice, maxAgeMs, command: rest } : { kind: "usage" };
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

/** Waits for the slot, naming each new holder once; false when `stopped` ended the wait. */
export async function acquire(
  env: SlotEnv,
  command: string,
  stopped: () => boolean,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
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
    await env.sleep(POLL_MS);
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

/** Runs the command under the slot and returns its exit code (a signal's code when one stopped it). */
export async function run(env: SlotEnv, argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.kind === "usage") {
    env.log(USAGE);
    return 2;
  }
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
    if (!(await acquire(env, args.command.join(" "), () => state.signal !== null, args.maxAgeMs))) {
      return state.signal ?? 1;
    }
    try {
      state.child = env.spawn(args.command, args.nice);
      const code = await state.child.wait();
      return state.signal ?? code;
    } finally {
      release(env);
    }
  } finally {
    stopListening();
  }
}
