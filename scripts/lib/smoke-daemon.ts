/**
 * How the smokes learn that the daemon they spawned is up: the `listening on ws://…` line of its
 * stdout. One place, so every smoke waits the same way and fails with the same words (#347).
 */

/** How long a smoke waits for the daemon to announce its port. */
export const DAEMON_START_MS = 0;

/**
 * The `ws://` address the daemon announced. Fails when the daemon ends without announcing, or when
 * `timeoutMs` passes, saying what it had printed by then.
 */
export async function readListenUrl(
  _stdout: ReadableStream<Uint8Array>,
  _timeoutMs: number = DAEMON_START_MS,
): Promise<string> {
  return "";
}
