import { lstat, mkdir, open, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { TaskFile, TaskPreviewResult, TaskResultsResult } from "@flightdeck/protocol";
import { inSequence } from "@flightdeck/protocol";
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
const PREVIEW_BYTES = 65_536;
/** What opens in a preview first: text, Markdown and CSV. */
const PREVIEWABLE = /\.(txt|md|markdown|csv)$/i;

/** What a file system call gives, or `fallback` when it fails (a folder or file that is gone). */
async function orElse<T, F>(run: () => Promise<T>, fallback: F): Promise<T | F> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

/**
 * Walks `folder` without following links or entering hidden folders, and without git: what a
 * plain file system says. Stops at the bounds instead of running away.
 */
async function walk(folder: string, into: Snapshot): Promise<void> {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: folder, depth: 0 }];
  let seen = 0;
  while (queue.length > 0 && seen < MAX_WALKED) {
    const { dir, depth } = queue.shift() as { dir: string; depth: number };
    const found = await scanFolder(dir, into, MAX_WALKED - seen);
    seen += found.files;
    if (depth < MAX_DEPTH)
      queue.push(...found.folders.map((path) => ({ dir: path, depth: depth + 1 })));
  }
}

/** One folder: records its files (at most `room`) in `into`, and lists the folders to walk next. */
async function scanFolder(
  dir: string,
  into: Snapshot,
  room: number,
): Promise<{ files: number; folders: string[] }> {
  const folders: string[] = [];
  let files = 0;
  const entries = await orElse(() => readdir(dir, { withFileTypes: true }), []);
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) folders.push(path);
    else if (entry.isFile()) {
      const info = await orElse(() => lstat(path), null);
      if (!info) continue;
      into[path] = { size: info.size, mtimeMs: info.mtimeMs };
      if (++files >= room) break;
    }
  }
  return { files, folders };
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
    await inSequence(folders, async (folder) => {
      await walk(folder, snapshot);
    });
    return snapshot;
  }

  /** Keeps the look under the task's session. */
  async keep(sessionId: string, folders: readonly string[], before: Snapshot): Promise<void> {
    await mkdir(this.opts.dir, { recursive: true });
    const kept: Kept = { folders: [...folders], before };
    await writeFile(this.file(sessionId), JSON.stringify(kept));
  }

  /** The start of a text file inside the task's folders (text, Markdown or CSV), for a preview. */
  async preview(sessionId: string, path: string): Promise<TaskPreviewResult> {
    const kept = await this.load(sessionId);
    const refused = () =>
      new FlightdeckError(
        "forbidden_cwd",
        "this file cannot be previewed",
        "task_preview_refused",
        {
          path,
        },
      );
    const target = resolve(path);
    if (!PREVIEWABLE.test(target) || !kept.folders.some((folder) => isInside(folder, target))) {
      throw refused();
    }
    // A link, or a link anywhere on the way, leads out of the folders: not read.
    const info = await orElse(() => lstat(target), null);
    const real = await orElse(() => realpath(target), null);
    if (
      !info?.isFile() ||
      real === null ||
      real !== (await realpath(dirname(target))).concat(sep, basename(target))
    ) {
      throw refused();
    }
    const handle = await open(target, "r");
    try {
      const buffer = Buffer.alloc(PREVIEW_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, PREVIEW_BYTES, 0);
      return {
        text: buffer.subarray(0, bytesRead).toString("utf8"),
        truncated: info.size > PREVIEW_BYTES,
      };
    } finally {
      await handle.close();
    }
  }

  private async load(sessionId: string): Promise<Kept> {
    try {
      return JSON.parse(await readFile(this.file(sessionId), "utf8")) as Kept;
    } catch {
      throw new FlightdeckError("not_found", `no task for ${sessionId}`, "task_unknown", {
        sessionId,
      });
    }
  }

  /** The files the task made or changed since, newest first, only inside its own folders. */
  async results(sessionId: string): Promise<TaskResultsResult> {
    const kept = await this.load(sessionId);
    const now: Snapshot = {};
    await inSequence(kept.folders, async (folder) => {
      await walk(folder, now);
    });
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
