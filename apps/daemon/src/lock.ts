import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
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
 * Takes the per-`dataDir` lock: a file holding the owner's pid. A lock whose pid is no longer
 * running (or is unreadable) is taken over. Returns `null` when another live process holds it.
 */
export async function acquireLock(dataDir: string): Promise<Lock | null> {
  await mkdir(dataDir, { recursive: true });
  const path = join(dataDir, LOCK_FILE);
  try {
    await (await open(path, "wx")).close();
  } catch {
    const owner = Number.parseInt(await readFile(path, "utf8"), 10);
    if (Number.isInteger(owner) && owner > 0 && isAlive(owner)) return null;
  }
  await writeFile(path, String(process.pid));
  let held = true;
  return {
    async release() {
      if (!held) return;
      held = false;
      await unlink(path);
    },
  };
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
