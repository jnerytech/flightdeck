import { FlightdeckError } from "../errors.ts";
import type { FileLog } from "./file-log.ts";

/** What `logs.tail` answers to a connection from `origin` (stub: nobody is refused). */
export async function tailForOrigin(
  log: FileLog,
  origin: string,
  lines: number,
  _warn?: (message: string) => void,
): Promise<{ lines: string[]; path: string }> {
  void FlightdeckError;
  return { lines: await log.tail(lines), path: log.path() };
}

/** The log file's path as `host.info` tells it to `origin`, or nothing (stub: always). */
export function logPathFor(
  log: FileLog,
  _origin: string,
): { logPath: string } | Record<string, never> {
  return { logPath: log.path() };
}
