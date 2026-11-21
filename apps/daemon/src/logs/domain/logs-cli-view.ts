/**
 * Issue #3736: what `flightdeckd logs tail` says, as pure rules over the daemon's answer. The terminal-control
 * scrub is the runner's (`said`, `json`).
 */
import type { LogTail } from "@flightdeck/protocol";

export interface LogsCliArgs {
  /** How many lines to read; the daemon's default when absent. */
  lines?: number;
  json?: boolean;
}

export const tailLines = (tail: LogTail): string[] =>
  tail.lines.length === 0 ? ["no log lines"] : tail.lines;

/** The keys a script reads, whatever else the daemon adds. */
export const tailJson = (tail: LogTail) => ({ lines: tail.lines, path: tail.path });
