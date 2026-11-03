/** `keyFor(` or `.projectKey(`: the project key read synchronously, which spawns git when cold. */
export const BLOCKING_KEY = /\b(?:keyFor|\.projectKey)\(/g;

/** The calls in `server.ts` that reach the blocking key path. */
export const SERVER_ALLOWED = 1;

/** How many blocking key reads a source has (stub: wrong value until the test is committed). */
export function blockingKeyCalls(_source: string): number {
  return -1;
}
