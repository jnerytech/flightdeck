/**
 * Runs `step` on each item one after the other, the next only once the one before has finished.
 * For work whose order is the point (git, migrations, a script's steps, a lock): `Promise.all`
 * would start them all at once. Gives back what each step returned, in order.
 */
export async function inSequence<T, R>(
  items: Iterable<T>,
  step: (item: T, index: number) => Promise<R> | R,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  for (const item of items) {
    results.push(await step(item, index++)); // NOSONAR: the one place a loop awaits on purpose: each step waits for the one before it
  }
  return results;
}
