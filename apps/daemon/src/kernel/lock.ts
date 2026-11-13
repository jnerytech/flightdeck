import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const LOCK_FILE = "flightdeckd.lock";

export interface Lock {
  release(): Promise<void>;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Takes the per-`dataDir` lock: a file holding the owner's pid, created whole by a hard link so a
 * reader never sees it empty. A lock whose pid is no longer running (or is unreadable) is taken
 * over: the stale file is moved away by a rename, which only one caller can win, and the move is
 * checked to hold the text that was judged stale. Returns `null` when another live process holds it.
 */
export async function acquireLock(dataDir: string): Promise<Lock | null> {
  await mkdir(dataDir, { recursive: true });
  const path = join(dataDir, LOCK_FILE);
  const token = String(process.pid);
  let taken = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && !taken; attempt++) {
    if (await createWhole(path, token)) {
      taken = true;
    } else {
      const text = await readFile(path, "utf8").catch(missingAsNull);
      if (text === null) continue;
      const owner = Number.parseInt(text, 10);
      if (Number.isInteger(owner) && owner > 0 && isAlive(owner)) return null;
      if (!(await moveStaleAway(path, text))) return null;
    }
  }
  if (!taken) return null;
  let held = true;
  return {
    async release() {
      if (!held) return;
      held = false;
      // Only a lock that still holds this pid goes; one taken over, or already gone, stays or is
      // gone as it is, and never hides the error that led here (#1676).
      if ((await readFile(path, "utf8").catch(missingAsNull)) !== token) return;
      await unlink(path).catch(missingAsNull);
    },
  };
}

/** Looks for the lock this many times before giving up: each retry means another caller moved first. */
const MAX_ATTEMPTS = 10;

function missingAsNull(error: NodeJS.ErrnoException): null {
  if (error.code !== "ENOENT") throw error;
  return null;
}

/** Creates `path` holding `text` in one step; false when it already exists. */
async function createWhole(path: string, text: string): Promise<boolean> {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, text);
  try {
    await link(temp, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    await unlink(temp).catch(missingAsNull);
  }
}

/**
 * Moves the stale lock holding `stale` out of the way. False when what was moved turned out to be
 * another text (a caller took over first and this one moved its fresh lock): it goes back.
 */
async function moveStaleAway(path: string, stale: string): Promise<boolean> {
  const moved = `${path}.stale.${process.pid}.${randomUUID()}`;
  try {
    await rename(path, moved);
  } catch (error) {
    // Another caller already moved it: look again.
    missingAsNull(error as NodeJS.ErrnoException);
    return true;
  }
  const text = await readFile(moved, "utf8").catch(missingAsNull);
  if (text !== stale && text !== null) await link(moved, path).catch(() => {});
  await unlink(moved).catch(missingAsNull);
  return text === stale;
}

/** The pid written in the lock of `dataDir`, or null without a readable one. */
export async function readLockPid(dataDir: string): Promise<number | null> {
  try {
    const pid = Number.parseInt(await readFile(join(dataDir, LOCK_FILE), "utf8"), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Exit code when another daemon already owns the same `dataDir`. */
export const EXIT_ALREADY_RUNNING = 3;

/** Another daemon already owns the same `dataDir` (its lock is held). */
export class AlreadyRunningError extends Error {
  constructor(dataDir: string, hint?: string) {
    const more = hint ? `; ${hint}` : "";
    super(`already running (dataDir ${dataDir})${more}`);
  }
}

/**
 * Runs `fn` while holding the lock of `dataDir`: refused with `AlreadyRunningError` (and the
 * `hint`) when a live process holds it, and the lock goes back when `fn` returns or throws.
 */
export async function withLock<T>(dataDir: string, hint: string, fn: () => Promise<T>): Promise<T> {
  const lock = await acquireLock(dataDir);
  if (!lock) throw new AlreadyRunningError(dataDir, hint);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}
