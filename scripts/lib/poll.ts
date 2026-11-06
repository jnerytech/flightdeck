/**
 * Looks at `check` again and again until it gives something, for a smoke that waits for a thing
 * to happen. Fails with the error `fail` makes once `timeoutMs` has passed.
 */
export async function pollUntil<T>(
  check: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  fail: () => Error,
  timeoutMs: number,
  everyMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check(); // NOSONAR: polling: each look follows the wait before it
    if (value) return value;
    if (Date.now() > deadline) throw fail();
    await Bun.sleep(everyMs); // NOSONAR: polling: each look follows the wait before it
  }
}
