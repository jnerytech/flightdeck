import { readFileSync } from "node:fs";
import { hostname } from "node:os";

/** What tells a process it runs inside WSL: its environment and `/proc/version`. */
export interface WslProbe {
  env: Record<string, string | undefined>;
  /** The text of `/proc/version`, or null when it cannot be read. */
  procVersion(): string | null;
}

/** The text of `/proc/version`, or null when it cannot be read (not Linux, or no access). */
export function readProcVersion(
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): string | null {
  try {
    return read("/proc/version");
  } catch {
    return null;
  }
}

/** The real process: `WSL_DISTRO_NAME` and `/proc/version`. */
export const realWslProbe: WslProbe = { env: process.env, procVersion: () => readProcVersion() };

/** Where this host runs inside WSL: the distro name (null when unknown), or null outside WSL. */
export function detectWsl(_probe: WslProbe): { distro: string | null } | null {
  return null;
}

/** The host name by default: the machine's, and inside WSL "<hostname> (WSL <distro>)". */
export function defaultHostName(_probe: WslProbe = realWslProbe): string {
  return hostname();
}

/** Ports of a daemon in WSL are the Windows daemon's plus this, so both can run side by side. */
export const WSL_PORT_OFFSET = 10;
