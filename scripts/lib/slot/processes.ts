/**
 * What the slot does to other processes: stops the waiters of a label or of a gone shell, tells
 * whether a call runs under the holder, and raises the niceness of the other test runs.
 */
import { isBunTest } from "./estimate.ts";
import { describeHolder, parseHolder, waiterPath } from "./holder.ts";
import type { ProcReader, SlotEnv } from "./types.ts";

/** A slot process: bun or node running scripts/slot.ts, not a program that only names the file. */
function isSlotProcess(argv: string[]): boolean {
  const program = (argv[0] ?? "")
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.exe$/, "");
  if (program !== "bun" && program !== "node") return false;
  return argv.slice(1, 3).some((arg) => /(?:^|[\\/])scripts[\\/]slot\.ts$/.test(arg));
}

/** How often a `--priority` run lowers the other test processes. */
export const RENICE_MS = 5000;

/** The niceness the other sessions' test processes are raised to. */
const NICE_OTHERS = 15;

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
export function underAncestor(env: SlotEnv): boolean {
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

export const ORPHANED =
  "slot: the shell that started this run is gone; giving up so the queue moves (rerun it if you still need it)";

/**
 * Whether this process was started by the process that holds the slot now: the variable names a
 * live pid, and the lock names the same one (a name left over from an old run is not enough).
 */
export function underHolder(env: SlotEnv): boolean {
  const { holder } = env;
  if (holder === undefined || !env.alive(holder)) return false;
  return parseHolder(env.fs.read(env.path))?.pid === holder;
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

/** Lowers the others every `RENICE_MS` until the command is done; a failure only skips a pass. */
export async function lowerWhile(env: SlotEnv, finished: { done: boolean }): Promise<void> {
  while (!finished.done) {
    try {
      await lowerOthers(env); // NOSONAR: sequential by design: each pass needs the answer of the one before
    } catch {
      // Listing or renicing is best effort: the run itself is not affected.
    }
    await env.sleep(RENICE_MS); // NOSONAR: poll interval: the wait between looks is the point of this loop
  }
}
