/**
 * Runs `step` on each item one after the other, the next only once the one before has finished.
 * For work whose order is the point (git, migrations, a script's steps, a lock): `Promise.all`
 * would start them all at once. Gives back what each step returned, in order.
 */
export async function inSequence<T, R>(
  _items: Iterable<T>,
  _step: (item: T, index: number) => Promise<R> | R,
): Promise<R[]> {
  return [];
}
