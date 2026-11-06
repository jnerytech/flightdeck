/**
 * The result of `work` as a promise, for a method that is async by contract but has nothing to
 * await: the work runs now, as the body of an async function would, and what it throws reaches
 * the caller as a rejection, never as an exception.
 */
export function settled<T>(_work: () => T): Promise<Awaited<T>> {
  return Promise.resolve(undefined as Awaited<T>);
}
