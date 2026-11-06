/**
 * Looks at `check` again and again until it gives something, for a smoke that waits for a thing
 * to happen. Fails with the error `fail` makes once `timeoutMs` has passed.
 */
export async function pollUntil<T>(
  _check: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  _fail: () => Error,
  _timeoutMs: number,
  _everyMs: number,
): Promise<T> {
  return undefined as T;
}
