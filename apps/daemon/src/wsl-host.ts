import { hostname, release } from "node:os";

/** What tells a process it runs inside WSL: its environment and `/proc/version`. */
export interface WslProbe {
  env: Record<string, string | undefined>;
  /** The text of `/proc/version`, or null when it cannot be read. */
  procVersion(): string | null;
}

/**
 * The kernel version text that names Microsoft under WSL, or null when it cannot be read. By
 * default it is the kernel release (`uname -r`, the same text as the start of `/proc/version`),
 * so no file is read synchronously.
 */
export function readProcVersion(read: (path: string) => string = () => release()): string | null {
  try {
    return read("/proc/version");
  } catch {
    return null;
  }
}

/** The real process: `WSL_DISTRO_NAME` and `/proc/version`. */
export const realWslProbe: WslProbe = { env: process.env, procVersion: () => readProcVersion() };

/** Where this host runs inside WSL: the distro name (null when unknown), or null outside WSL. */
export function detectWsl(probe: WslProbe): { distro: string | null } | null {
  const distro = probe.env.WSL_DISTRO_NAME;
  if (distro) return { distro };
  return /microsoft/i.test(probe.procVersion() ?? "") ? { distro: null } : null;
}

/** The host name by default: the machine's, and inside WSL "<hostname> (WSL <distro>)". */
export function defaultHostName(probe: WslProbe = realWslProbe): string {
  const wsl = detectWsl(probe);
  if (!wsl) return hostname();
  return `${hostname()} (WSL${wsl.distro ? " " + wsl.distro : ""})`;
}

/** Ports of a daemon in WSL are the Windows daemon's plus this, so both can run side by side. */
export const WSL_PORT_OFFSET = 10;
