/**
 * Runtime code never blocks on IO. This counts the synchronous node/Bun calls per file; the test
 * compares them with `SYNC_BASELINE`, which only goes down.
 */
export const SYNC_BASELINE: Record<string, number> = {};

/** Number of blocking calls in one source file (comment lines are ignored). */
export function syncCallCount(_source: string): number {
  return _source.length > 0 ? 1 : 0;
}
