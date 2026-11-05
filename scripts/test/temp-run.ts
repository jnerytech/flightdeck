/**
 * A temp folder of each test run's own. The preload points TEMP, TMP and TMPDIR at a fresh
 * `fd-run-*` folder before anything else, so every folder a test, a guard or a child process makes
 * lands there, and removes it at the end. The suite used to leave everything behind: on a machine
 * that ran it often, TEMP held hundreds of thousands of folders, and a child bun started under it
 * read them all at start (about 150 ms per fake CLI call on Windows).
 *
 * What a process still holds (a file open on Windows) can keep the folder from going; the run's pid
 * is written in it, and the next run sweeps the `fd-run-*` folders whose process is gone.
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

export interface TempRun {
  /** The temp folder the run found. */
  base: string;
  /** The run's own folder inside it. */
  dir: string;
}

const PREFIX = "fd-run-";

/** Whether a process with this pid exists (signal 0 only asks). */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, it is someone else's.
    return (error as { code?: string }).code === "EPERM";
  }
}

/** How long one removal may take: well under a hook's timeout, which a big tree on Windows overran. */
const REMOVE_BUDGET_MS = 3000;

/** Removes what `dir` holds, file by file, until the deadline; `keep` is left for the caller. */
function empty(
  dir: string,
  deadline: number,
  now: () => number,
  keep?: string,
  root = realpathSync(dir),
): boolean {
  let clear = true;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === keep) continue;
    if (now() >= deadline) return false;
    const path = join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        if (empty(path, deadline, now, undefined, root)) rmdirSync(path);
        else clear = false;
      } else if (entry.isSymbolicLink()) {
        // A link goes as a link. A chmod would follow it to what it points at: the PATH guard links
        // the user's own programs here, and every run left them at 0666 (#232).
        unlinkSync(path);
      } else {
        // A read-only file (git's objects) is not removable on Windows until it is writable. Only
        // a file of this folder, never a link's target.
        try {
          if (!lstatSync(path).isSymbolicLink() && realpathSync(path).startsWith(root + sep)) {
            chmodSync(path, 0o666);
          }
        } catch {
          // Not ours to change: the removal below says whether it matters.
        }
        unlinkSync(path);
      }
    } catch {
      // Held (a file open on Windows): the next run's sweep tries again.
      clear = false;
    }
  }
  return clear;
}

/**
 * Removes a folder and what it holds within the budget; true when it is gone. The pid file goes last,
 * so a folder left half-removed is still known as a dead run's and the next sweep finishes it. Never
 * throws.
 */
function remove(dir: string, budgetMs: number, now: () => number, keep?: string): boolean {
  try {
    if (!existsSync(dir)) return true;
    if (!empty(dir, now() + budgetMs, now, keep)) return false;
    if (keep) unlinkSync(join(dir, keep));
    rmdirSync(dir);
  } catch {
    // Reported by the caller through the folder still being there.
  }
  return !existsSync(dir);
}

/** The `fd-run-*` folders in `base` whose run left its pid and is gone. A folder with no pid yet is starting. */
function sweep(base: string, alive: (pid: number) => boolean): void {
  // Never throws: starting processes sweep the same folders at once, so a pid file can vanish or be
  // held between one look and the next (EPERM or EBUSY on Windows), and the preload must not die.
  // One dead folder per start: the budget is spent once, and the next start takes the next.
  try {
    for (const name of readdirSync(base)) {
      if (!name.startsWith(PREFIX)) continue;
      const pidFile = join(base, name, "pid");
      let pid: number;
      try {
        pid = Number(readFileSync(pidFile, "utf8").trim());
      } catch {
        continue;
      }
      if (Number.isInteger(pid) && pid > 0 && alive(pid)) continue;
      remove(join(base, name), REMOVE_BUDGET_MS, Date.now, "pid");
      return;
    }
  } catch {
    // The temp folder could not be listed: nothing to sweep.
  }
}

/** Sweeps what dead runs left, makes this run's folder and points TEMP, TMP and TMPDIR at it. */
export function installTempRun(
  env: Record<string, string | undefined> = process.env,
  base: string = tmpdir(),
  alive: (pid: number) => boolean = pidAlive,
): TempRun {
  sweep(base, alive);
  const dir = mkdtempSync(join(base, PREFIX));
  writeFileSync(join(dir, "pid"), String(process.pid));
  env.TEMP = dir;
  env.TMP = dir;
  env.TMPDIR = dir;
  return { base, dir };
}

/** Removes the run's folder within the budget; true when it is gone, false when the sweep has to finish. */
export function removeTempRun(
  run: TempRun,
  budgetMs: number = REMOVE_BUDGET_MS,
  now: () => number = Date.now,
): boolean {
  return remove(run.dir, budgetMs, now, "pid");
}
