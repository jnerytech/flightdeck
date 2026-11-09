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

const CLIENT_CAP = 64;
/** A WebSocket close reason is at most 123 bytes. */
const REASON_CAP = 123;

/** One plain line of what a peer said: no token, no control character, no quote that closes the field. */
function plain(text: string, token: string, cap: number): string {
  const hidden = token ? text.split(token).join("[token]") : text;
  return hidden
    .replaceAll(/\p{Cc}+/gu, " ")
    .replaceAll('"', "'")
    .slice(0, cap);
}

const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;

export function closeLine(facts: CloseFacts, token: string): string {
  const client = facts.client === null ? "unknown" : `"${plain(facts.client, token, CLIENT_CAP)}"`;
  const by = facts.byDaemon === null ? "the peer" : `the daemon (${facts.byDaemon})`;
  const pong =
    facts.pongAgoMs === null ? "no pong yet" : `last pong ${seconds(facts.pongAgoMs)} ago`;
  return [
    `connection #${facts.id} closed: client ${client}`,
    `code ${facts.code} "${plain(facts.reason, token, REASON_CAP)}"`,
    `by ${by}`,
    `up ${seconds(facts.upMs)}`,
    `last frame ${seconds(facts.silentMs)} ago`,
    pong,
  ].join(", ");
}
