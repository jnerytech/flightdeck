import { hostname, release } from "node:os";
import { hostNameIn, type WslProbe } from "./domain/host.ts";

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

/** The host name by default: the machine's, and inside WSL "<hostname> (WSL <distro>)". */
export function defaultHostName(probe: WslProbe = realWslProbe): string {
  return hostNameIn(hostname(), probe);
}
