import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import type { TaskFile, TaskResultsResult } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import { isInside } from "../paths.ts";

/** Names, sizes and times of the files of some folders, to compare with later. */
export type Snapshot = Record<string, { size: number; mtimeMs: number }>;

interface Kept {
  folders: string[];
  before: Snapshot;
}

/** Files looked at per folder at most, and how deep: a task folder is never a whole disk. */
const MAX_WALKED = 5000;
const MAX_DEPTH = 8;
const DEFAULT_CAP = 200;

/**
 * Walks `folder` without following links or entering hidden folders, and without git: what a
 * plain file system says. Stops at the bounds instead of running away.
 */
async function walk(folder: string, into: Snapshot): Promise<void> {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: folder, depth: 0 }];
  let seen = 0;
  while (queue.length > 0 && seen < MAX_WALKED) {
    const { dir, depth } = queue.shift() as { dir: string; depth: number };
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH) queue.push({ dir: path, depth: depth + 1 });
      } else if (entry.isFile()) {
        const info = await lstat(path).catch(() => null);
        if (!info) continue;
        into[path] = { size: info.size, mtimeMs: info.mtimeMs };
        if (++seen >= MAX_WALKED) break;
      }
    }
  }
}

/** Remembers what a task's folders held when it started, and says what it made since. */
export class TaskTracker {
  private readonly cap: number;

  constructor(readonly opts: { dir: string; cap?: number }) {
    this.cap = opts.cap ?? DEFAULT_CAP;
  }

  private file(sessionId: string): string {
    // The session id is the daemon's own (a ulid), but it names a file here: keep it a plain name.
    return join(this.opts.dir, `${basename(sessionId).replace(/[^\w-]/g, "_")}.json`);
  }

  /** A look at the folders before the task starts. */
  async prepare(folders: readonly string[]): Promise<Snapshot> {
    const snapshot: Snapshot = {};
    for (const folder of folders) await walk(folder, snapshot);
    return snapshot;
  }

  /** Keeps the look under the task's session. */
  async keep(sessionId: string, folders: readonly string[], before: Snapshot): Promise<void> {
    await mkdir(this.opts.dir, { recursive: true });
    const kept: Kept = { folders: [...folders], before };
    await writeFile(this.file(sessionId), JSON.stringify(kept));
  }

  /** The files the task made or changed since, newest first, only inside its own folders. */
  async results(sessionId: string): Promise<TaskResultsResult> {
    let kept: Kept;
    try {
      kept = JSON.parse(await readFile(this.file(sessionId), "utf8")) as Kept;
    } catch {
      throw new FlightdeckError("not_found", `no task for ${sessionId}`, "task_unknown", {
        sessionId,
      });
    }
    const now: Snapshot = {};
    for (const folder of kept.folders) await walk(folder, now);
    const files: TaskFile[] = [];
    for (const [path, info] of Object.entries(now)) {
      if (!kept.folders.some((folder) => isInside(folder, path))) continue;
      const was = kept.before[path];
      if (was && was.size === info.size && was.mtimeMs === info.mtimeMs) continue;
      files.push({
        path,
        name: relative(join(path, ".."), path),
        sizeBytes: info.size,
        modifiedAt: new Date(info.mtimeMs).toISOString(),
        change: was ? "changed" : "new",
      });
    }
    files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.path.localeCompare(b.path));
    return { files: files.slice(0, this.cap), truncated: files.length > this.cap };
  }
}
