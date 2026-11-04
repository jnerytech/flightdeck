/** Why a host is offline, as far as a browser WebSocket can tell: it only reports that the socket closed. */
export type OfflineKind = "refused" | "timeout" | "lost";

/** The last failed try and when the next automatic one is due (epoch milliseconds). */
export interface RetryState {
  kind: OfflineKind;
  lastTryAt: number;
  nextRetryAt: number;
}

/** Seconds the daemon has been up now, from what `host.info` said when it was received. */
export function hostUptime(uptimeSec: number, _receivedAt: number, _now: number): number {
  return uptimeSec;
}

/** Which troubleshooting hint fits: the Linux/WSL one has the linger commands. */
export function offlineHint(
  _kind: OfflineKind,
  _url: string,
  _os: string | null,
): "linux" | "generic" | "none" {
  return "none";
}
