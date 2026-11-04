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

/** Which troubleshooting hint fits: the Linux/WSL one has the linger commands. */
export function offlineHint(
  kind: OfflineKind,
  url: string,
  os: string | null,
): "linux" | "generic" | "none" {
  if (kind !== "refused") return "generic";
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    // An address that does not parse falls back to the OS the host last reported.
  }
  const local = hostname === "localhost" || hostname === "[::1]" || hostname.startsWith("127.");
  return local || os === "linux" ? "linux" : "generic";
}
