/**
 * Issue #1532 (for #939): the daemon's one line for a client connection that closed, so the next
 * real run says why a host went offline. Never the token, never a message: who (the client's own
 * name), the close code and reason, which side closed it, and the clocks.
 */

export interface CloseFacts {
  /** The daemon's own count of connections, in the order they opened. */
  id: number;
  /** The name the client gave in `hello`; null before it said hello. */
  client: string | null;
  code: number;
  reason: string;
  /** What made the daemon close it (heartbeat timeout, unauthorized, ...); null: the peer closed. */
  byDaemon: string | null;
  /** How long the connection was open. */
  upMs: number;
  /** How long since the last frame of any kind came from the client. */
  silentMs: number;
  /** How long since the client last answered a ping; null when it never did. */
  pongAgoMs: number | null;
}

export function closeLine(_facts: CloseFacts, _token: string): string {
  return "";
}
