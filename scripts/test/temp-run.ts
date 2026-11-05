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
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

/** Removes a folder and what it holds; true when it is gone. */
function remove(dir: string): boolean {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // Reported by the caller through the folder still being there.
  }
  return !existsSync(dir);
}

/** The `fd-run-*` folders in `base` whose run left its pid and is gone. A folder with no pid yet is starting. */
function sweep(base: string, alive: (pid: number) => boolean): void {
  for (const name of readdirSync(base)) {
    if (!name.startsWith(PREFIX)) continue;
    const pidFile = join(base, name, "pid");
    if (!existsSync(pidFile)) continue;
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    if (Number.isInteger(pid) && pid > 0 && alive(pid)) continue;
    remove(join(base, name));
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

/** Removes the run's folder; true when it is gone. */
export function removeTempRun(run: TempRun, _budgetMs?: number, _now?: () => number): boolean {
  return remove(run.dir);
}
