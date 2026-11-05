import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import type { SecretScanner } from "@flightdeck/protocol";

export interface FileLogOptions {
  dir: string;
  /** A file is rotated when it passes this many bytes (5 MB when absent). */
  maxBytes?: number;
  /** How many files are kept, the live one included (5 when absent). */
  files?: number;
  scanner: Pick<SecretScanner, "redact">;
  now?: () => number;
}

const NAME = "flightdeckd.log";
/** A message is cut here: a log line is for reading, not for dumping a payload. */
const MAX_LINE = 2000;
/** `tail` hands out this many lines at most. */
const MAX_TAIL = 500;

/**
 * The daemon's log file: every line redacted before it is written, one file that rotates into
 * `.1`, `.2`… up to `files` of them. A folder that cannot be written is ignored: logging never
 * stops the daemon.
 */
export class FileLog {
  private readonly maxBytes: number;
  private readonly files: number;
  private readonly now: () => number;

  constructor(private readonly opts: FileLogOptions) {
    this.maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
    this.files = opts.files ?? 5;
    this.now = opts.now ?? Date.now;
  }

  path(): string {
    return join(this.opts.dir, NAME);
  }

  write(level: "info" | "error", message: string): void {
    try {
      const text = this.opts.scanner
        .redact(message)
        .replace(/[\r\n]+/g, " ")
        .slice(0, MAX_LINE);
      const line = `${new Date(this.now()).toISOString()} ${level === "error" ? "ERROR" : "INFO"} ${text}\n`;
      mkdirSync(this.opts.dir, { recursive: true });
      this.rotateFor(line.length);
      appendFileSync(this.path(), line);
    } catch {
      // A log that cannot be written is not worth stopping for.
    }
  }

  /** Makes room: when the live file would pass the limit, the files shift one place up. */
  private rotateFor(incoming: number): void {
    const live = this.path();
    if (!existsSync(live) || statSync(live).size + incoming <= this.maxBytes) return;
    const oldest = `${live}.${this.files - 1}`;
    if (existsSync(oldest)) rmSync(oldest);
    for (let n = this.files - 2; n >= 1; n--) {
      const from = `${live}.${n}`;
      if (existsSync(from)) renameSync(from, `${live}.${n + 1}`);
    }
    renameSync(live, `${live}.1`);
  }

  /** The last `lines` lines (500 at most), newest last, across the rotated files, redacted again. */
  async tail(lines: number): Promise<string[]> {
    const wanted = Math.min(Math.max(Math.floor(lines), 0), MAX_TAIL);
    if (wanted === 0) return [];
    const out: string[] = [];
    for (let n = 0; n < this.files && out.length < wanted; n++) {
      const file = n === 0 ? this.path() : `${this.path()}.${n}`;
      if (!existsSync(file)) continue;
      const text = readFileSync(file, "utf8").split("\n").filter(Boolean);
      out.unshift(...text.slice(-(wanted - out.length)));
    }
    return out.slice(-wanted).map((line) => this.opts.scanner.redact(line));
  }
}
