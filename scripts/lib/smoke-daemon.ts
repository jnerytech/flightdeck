/**
 * How the smokes learn that the daemon they spawned is up: the `listening on ws://…` line of its
 * stdout. One place, so every smoke waits the same way and fails with the same words (#347).
 */

/**
 * How long a smoke waits for the daemon to announce its port. Measured on 300 daemon starts in ten
 * Windows CI runs (#347): the median is 1.2 s, the 95th percentile 2.3 s, and a run on a degraded
 * runner took up to 17 s. The daemon's own work before the announcement is about 0.1-0.2 s on a
 * slow board; the rest is the process starting and loading its modules, which a cold runner can
 * stall. The limit is about twice the worst start seen, not a guess at a typical one.
 */
export const DAEMON_START_MS = 30_000;

/**
 * The `ws://` address the daemon announced. Fails when the daemon ends without announcing, or when
 * `timeoutMs` passes, saying what it had printed by then.
 */
export async function readListenUrl(
  stdout: ReadableStream<Uint8Array>,
  timeoutMs: number = DAEMON_START_MS,
): Promise<string> {
  const decoder = new TextDecoder();
  const started = Date.now();
  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, fail) => {
    timer = setTimeout(
      () =>
        fail(
          new Error(
            `timeout: daemon anunciar a porta (${timeoutMs} ms; it printed: ${buffer.slice(-300) || "nothing"})`,
          ),
        ),
      timeoutMs,
    );
  });
  const announced = (async () => {
    for await (const chunk of stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      const match = buffer.match(/listening on (ws:\/\/\S+)/);
      if (match?.[1]) return match[1];
    }
    throw new Error(
      `daemon saiu sem anunciar a porta (after ${Date.now() - started} ms): ${buffer}`,
    );
  })();
  try {
    return await Promise.race([announced, late]);
  } finally {
    clearTimeout(timer);
    // The loser may reject later with nobody waiting: that is not an unhandled error.
    announced.catch(() => {});
    late.catch(() => {});
  }
}

/**
 * The same, for a smoke that collects the daemon's output itself: `read` gives what was printed so
 * far, and the address is waited for by looking again until the limit.
 */
export async function awaitListenUrl(
  read: () => string,
  timeoutMs: number = DAEMON_START_MS,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const printed = read();
    const found = printed.match(/listening on (ws:\/\/\S+)/)?.[1];
    if (found) return found;
    if (Date.now() > deadline) {
      throw new Error(
        `timeout: daemon anunciar a porta (${timeoutMs} ms; it printed: ${printed.slice(-300) || "nothing"})`,
      );
    }
    await Bun.sleep(20);
  }
}
