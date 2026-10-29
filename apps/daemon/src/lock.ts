import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const LOCK_FILE = "flightdeckd.lock";

export interface Lock {
  release(): void;
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
export function acquireLock(dataDir: string): Lock | null {
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, LOCK_FILE);
  try {
    closeSync(openSync(path, "wx"));
  } catch {
    const owner = Number.parseInt(readFileSync(path, "utf8"), 10);
    if (Number.isInteger(owner) && owner > 0 && isAlive(owner)) return null;
  }
  writeFileSync(path, String(process.pid));
  let held = true;
  return {
    release() {
      if (!held) return;
      held = false;
      unlinkSync(path);
    },
  };
}

/** The pid written in the lock of `dataDir`, or null without a readable one. */
export function readLockPid(dataDir: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(join(dataDir, LOCK_FILE), "utf8"), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}
