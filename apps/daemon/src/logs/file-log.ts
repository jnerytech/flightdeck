import { appendFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SecretScanner } from "@flightdeck/protocol";

export interface FileLogOptions {
  dir: string;
  /** A file is rotated when it passes this many bytes (5 MB when absent). */
  maxBytes?: number;
  /** How many files are kept, the live one included (5 when absent). */
  files?: number;
  scanner: Pick<SecretScanner, "redact">;
  /** The user's home folder: it is `~` in every line (stub). */
  home?: string;
  now?: () => number;
}

const NAME = "flightdeckd.log";
/** A message is cut here: a log line is for reading, not for dumping a payload. */
const MAX_LINE = 2000;
/** `tail` hands out this many lines at most. */
const MAX_TAIL = 500;

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
      const text = this.opts.scanner
        .redact(message, false)
        .replace(/[\r\n]+/g, " ")
        .slice(0, MAX_LINE);
      line = `${new Date(this.now()).toISOString()} ${level === "error" ? "ERROR" : "INFO"} ${text}\n`;
    } catch {
      return;
    }
    this.queue = this.queue.then(() => this.append(line));
  }

  private async append(line: string): Promise<void> {
    try {
      await mkdir(this.opts.dir, { recursive: true });
      await this.rotateFor(line.length);
      await appendFile(this.path(), line);
    } catch {
      // A log that cannot be written is not worth stopping for.
    }
  }

  /** Makes room: when the live file would pass the limit, the files shift one place up. */
  private async rotateFor(incoming: number): Promise<void> {
    const live = this.path();
    const size = await stat(live).then(
      (info) => info.size,
      () => null,
    );
    if (size === null || size + incoming <= this.maxBytes) return;
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
      const body = await readFile(file, "utf8").catch(() => null);
      if (body === null) continue;
      out.unshift(
        ...body
          .split("\n")
          .filter(Boolean)
          .slice(-(wanted - out.length)),
      );
    }
    return out.slice(-wanted).map((line) => this.opts.scanner.redact(line, false));
  }
}
