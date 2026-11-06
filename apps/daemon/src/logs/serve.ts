import { isVaultTransport, requireVaultTransport } from "../vault/vault.ts";
import type { FileLog } from "./file-log.ts";

/**
 * What `logs.tail` answers to a connection from `origin`: only loopback and Tailscale get the host's
 * log (it holds paths and whatever the scanner missed), like the vault. Anyone else is refused.
 */
export async function tailForOrigin(
  log: FileLog,
  origin: string,
  lines: number,
  warn?: (message: string) => void,
): Promise<{ lines: string[]; path: string }> {
  requireVaultTransport(origin, "logs.tail", warn);
  return { lines: await log.tail(lines), path: log.path() };
}

/** The log file's path as `host.info` tells it to `origin`: only to loopback and Tailscale. */
export function logPathFor(
  log: FileLog,
  origin: string,
): { logPath: string } | Record<string, never> {
  return isVaultTransport(origin) ? { logPath: log.path() } : {};
}
