/**
 * The result of `work` as a promise, for a method that is async by contract but has nothing to
 * await: the work runs now, as the body of an async function would, and what it throws reaches
 * the caller as a rejection, never as an exception.
 */
export function settled<T>(work: () => T): Promise<Awaited<T>> {
  try {
    return Promise.resolve(work()) as Promise<Awaited<T>>;
  } catch (error) {
    return Promise.reject(error);
  }
}
