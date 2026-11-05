import type { SecretScanner } from "@flightdeck/protocol";

export interface FileLogOptions {
  dir: string;
  /** A file is rotated when it passes this many bytes. */
  maxBytes?: number;
  /** How many files are kept, the live one included. */
  files?: number;
  scanner: Pick<SecretScanner, "redact">;
  now?: () => number;
}

/** A rotated log file whose every line is redacted first. (Stub.) */
export class FileLog {
  constructor(_opts: FileLogOptions) {}
  path(): string {
    return "";
  }
  write(_level: "info" | "error", _message: string): void {}
  async tail(_lines: number): Promise<string[]> {
    return [];
  }
}
