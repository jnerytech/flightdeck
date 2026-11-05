import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { type SecretScanner, scrubHome } from "@flightdeck/protocol";

export interface FileLogOptions {
  dir: string;
  /** A file is rotated when it passes this many bytes (5 MB when absent). */
  maxBytes?: number;
  /** How many files are kept, the live one included (5 when absent). */
  files?: number;
  scanner: Pick<SecretScanner, "redact">;
  /** The user's home folder: it is `~` in every line, besides the usual folders of the systems. */
  home?: string;
  now?: () => number;
}

const NAME = "flightdeckd.log";
/** A message is cut here: a log line is for reading, not for dumping a payload. */
const MAX_LINE = 2000;
/** `tail` hands out this many lines at most. */
const MAX_TAIL = 500;
/** `tail` reads this much of the end of each file at most. */
const TAIL_BYTES = 256 * 1024;
/** Never through a link; `0` where the system has no such flag (the link is then checked by hand). */
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

/**
 * The daemon's log file: every line redacted before it is queued, one file that rotates into
 * `.1`, `.2`… up to `files` of them. Nothing here blocks the daemon: `write` queues the line and
 * a single chain of async writes puts the lines on the disk in order. A folder that cannot be
 * written is ignored: logging never stops the daemon.
 */
export class FileLog {
  private readonly maxBytes: number;
  private readonly files: number;
  private readonly now: () => number;
  /** The writes so far, one after the other; never rejects. */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly opts: FileLogOptions) {
    this.maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
    this.files = opts.files ?? 5;
    this.now = opts.now ?? Date.now;
  }

  path(): string {
    return join(this.opts.dir, NAME);
  }

  /** Resolves when every line written so far has been dealt with (written, or dropped on a failure). */
  flush(): Promise<void> {
    return this.queue;
  }

  write(level: "info" | "error", message: string): void {
    let line: string;
    try {
      const text = this.clean(message)
        .replace(/[\r\n]+/g, " ")
        .slice(0, MAX_LINE);
      line = `${new Date(this.now()).toISOString()} ${level === "error" ? "ERROR" : "INFO"} ${text}\n`;
    } catch {
      return;
    }
    this.queue = this.queue.then(() => this.append(line));
  }

  /** Secrets out, then the user's name out of the paths. */
  private clean(text: string): string {
    return scrubHome(this.opts.scanner.redact(text, false), this.opts.home);
  }

  private async append(line: string): Promise<void> {
    try {
      // Private to the user: the lines hold paths and host names.
      await mkdir(this.opts.dir, { recursive: true, mode: 0o700 });
      await this.rotateFor(line.length);
      // Never through a link: a link planted where the log goes would write somewhere else.
      if (await isLink(this.path())) return;
      const file = await open(
        this.path(),
        constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | NO_FOLLOW,
        0o600,
      );
      try {
        await file.appendFile(line);
      } finally {
        await file.close();
      }
    } catch {
      // A log that cannot be written is not worth stopping for.
    }
  }

  /** Makes room: when the live file would pass the limit, the files shift one place up. */
  private async rotateFor(incoming: number): Promise<void> {
    const live = this.path();
    const info = await lstat(live).catch(() => null);
    if (info === null || !info.isFile() || info.size + incoming <= this.maxBytes) return;
    await rm(`${live}.${this.files - 1}`, { force: true });
    for (let n = this.files - 2; n >= 1; n--) {
      await rename(`${live}.${n}`, `${live}.${n + 1}`).catch(() => {});
    }
    await rename(live, `${live}.1`);
  }

  /** The last `lines` lines (500 at most), newest last, across the rotated files, redacted again. */
  async tail(lines: number): Promise<string[]> {
    const wanted = Math.min(Math.max(Math.floor(lines), 0), MAX_TAIL);
    if (wanted === 0) return [];
    // What is still queued goes to the disk first: a reader sees what was just written.
    await this.flush();
    const out: string[] = [];
    for (let n = 0; n < this.files && out.length < wanted; n++) {
      const file = n === 0 ? this.path() : `${this.path()}.${n}`;
      const body = await readEnd(file);
      if (body === null) continue;
      out.unshift(
        ...body
          .split("\n")
          .filter(Boolean)
          .slice(-(wanted - out.length)),
      );
    }
    return out.slice(-wanted).map((line) => this.clean(line));
  }
}

/** Whether `path` is a link of any kind (the link itself is looked at, never what it points to). */
async function isLink(path: string): Promise<boolean> {
  const info = await lstat(path).catch(() => null);
  return info?.isSymbolicLink() ?? false;
}

/**
 * The end of a regular file, at most `TAIL_BYTES` of it, from the start of a whole line; null for
 * a file that is missing, a link or not a regular file.
 */
async function readEnd(path: string): Promise<string | null> {
  if (await isLink(path)) return null;
  let file: Awaited<ReturnType<typeof open>>;
  try {
    file = await open(path, constants.O_RDONLY | NO_FOLLOW);
  } catch {
    return null;
  }
  try {
    const info = await file.stat();
    if (!info.isFile()) return null;
    const start = Math.max(0, info.size - TAIL_BYTES);
    const buffer = Buffer.alloc(info.size - start);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    // A window that starts in the middle of a line does not hand out the piece.
    return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
  } catch {
    return null;
  } finally {
    await file.close();
  }
}
