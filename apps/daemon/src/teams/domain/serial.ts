/**
 * One task at a time per key (#2090): two changes to the same team's members must not read the
 * same list, so a second one waits for the first and then reads what the first left.
 */
export class PerKeyQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(key) ?? Promise.resolve()).then(task);
    const tail = result.catch(() => undefined);
    this.tails.set(key, tail);
    // Nothing left to wait for: forget the key so the map does not grow with every team.
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}
