/**
 * The full-gate slot: one exclusive lock for the heavy commands (full suite, e2e, shots, smokes,
 * builds), so two sessions never run them at once. Every effect (files, clock, processes) comes
 * in through `SlotEnv`, so the tests run nothing real and wait for nothing.
 */
import {
  estimatedSeconds,
  SLOT_TEST_FILES,
  SLOT_TEST_FILES_CAP,
  SLOT_TEST_SECONDS,
  testFileCount,
} from "./estimate.ts";
import { heavyReasonGiven } from "./heavy.ts";
import { clip, describeHolder, oneLine, parseHolder, waiterPath } from "./holder.ts";
import { cancel, lowerWhile, ORPHANED, reap, underAncestor, underHolder } from "./processes.ts";
import type { Attempt, SlotArgs, SlotChild, SlotEnv, SlotHolder } from "./types.ts";

export { estimatedSeconds, SLOT_TEST_FILES, testFileCount, timingsFrom } from "./estimate.ts";
export { describeHolder, parseHolder } from "./holder.ts";
export { cancel, lowerOthers, RENICE_MS } from "./processes.ts";
export type { ProcessInfo, ProcReader, SlotChild, SlotEnv, SlotHolder } from "./types.ts";

export const POLL_MS = 2000;
/** A holder older than this is reported as suspicious (never taken over). */
export const DEFAULT_MAX_AGE_MS = 90 * 60_000;
/** A hold past this is LONG: the holder, its waiters and `--status` say so, and the hook log keeps it (#833). */
export const LONG_HOLD_MS = 20 * 60_000;
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

/**
 * The live waiters, first come first: by the time they queued, then by pid (#372). Dead or
 * unreadable waiter files count for nothing, and a pid shows once (a waiter file being written
 * has a staging copy under the same prefix).
 */
function waiters(env: SlotEnv): SlotHolder[] {
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
 * #833: a run of more than `SLOT_TEST_FILES` test files holds the slot 20 minutes or more while
 * others wait, so it needs FLIGHTDECK_SLOT_HEAVY with a reason. #1541: with the CI timings known,
 * the limit is `SLOT_TEST_SECONDS` of estimated CI time instead. The refusal (with the label, the
 * count and the estimate) and the waiver both go to the hook log. True when the run is refused.
 */
function refusedOverLimit(env: SlotEnv, command: string[]): boolean {
  const count = testFileCount(command);
  if (count === 0) return false;
  const seconds = env.timings ? Math.round(estimatedSeconds(command, env.timings, env.root)) : null;
  const within = seconds === null ? count <= SLOT_TEST_FILES : seconds <= SLOT_TEST_SECONDS;
  if (within && count <= SLOT_TEST_FILES_CAP) return false;
  const reason = (env.heavyReason ?? "").trim();
  if (heavyReasonGiven(reason)) {
    env.record?.("slot-files", "waived", { detail: reason.slice(0, 200) });
    return false;
  }
  const size =
    seconds === null ? `${count} test files` : `${count} test files, about ${seconds} s of CI time`;
  const limit =
    seconds === null
      ? `more than ${SLOT_TEST_FILES} need a reason (#833)`
      : `more than ${SLOT_TEST_SECONDS} s need a reason (#833, #1541)`;
  env.log(
    `slot: ${size} would hold the slot for minutes while others wait; ${limit}. Run fewer: each touched test with \`bun --config=bunfig.area.toml test <file>\`, or \`bun run test:related -- --fast --tier unit,component\` on a smaller change; CI runs the rest. For a real need, put FLIGHTDECK_SLOT_HEAVY="<reason>" in front of the command (of \`bun run test:related\` too).`,
  );
  env.record?.("slot-files", "block", { detail: `${oneLine(env.label)}: ${size}` });
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
