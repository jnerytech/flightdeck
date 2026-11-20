/** Why a host is offline, as far as a browser WebSocket can tell: it only reports that the socket closed. */
export type OfflineKind = "refused" | "timeout" | "lost";

/** The last failed try and when the next automatic one is due (epoch milliseconds). */
export interface RetryState {
  kind: OfflineKind;
  lastTryAt: number;
  nextRetryAt: number;
}

/** Seconds the daemon has been up now, from what `host.info` said when it was received. */
export function hostUptime(uptimeSec: number, receivedAt: number, now: number): number {
  return uptimeSec + Math.max(0, Math.floor((now - receivedAt) / 1000));
}

/** Whether a refused connection to this address may be the daemon refusing this machine (not a loopback one). */
export function mayBeRefusedAddress(kind: OfflineKind, url: string): boolean {
  if (kind !== "refused") return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return !(hostname === "localhost" || hostname === "[::1]" || hostname.startsWith("127."));
  } catch {
    return false;
  }
}

/**
 * Which troubleshooting hint fits the host's OS: the Linux/WSL one has the linger commands, the
 * Windows one the service commands. A loopback host that has not reported its OS yet keeps the
 * Linux one; any other OS gets the generic text.
 */
export function offlineHint(
  kind: OfflineKind,
  url: string,
  os: string | null,
): "linux" | "windows" | "generic" | "none" {
  if (kind !== "refused") return "generic";
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    // An address that does not parse falls back to the OS the host last reported.
  }
  const local = hostname === "localhost" || hostname === "[::1]" || hostname.startsWith("127.");
  if (os === "win32") return "windows";
  return os === "linux" || (local && os === null) ? "linux" : "generic";
}
