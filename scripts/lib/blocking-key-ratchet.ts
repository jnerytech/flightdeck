/** `keyFor(` or `.projectKey(`: the project key read synchronously, which spawns git when cold. */
export const BLOCKING_KEY = /\b(?:keyFor|\.projectKey)\(/g;

/** The calls in `server.ts` that reach the blocking key path. */
export const SERVER_ALLOWED = 1;

/** How many blocking key reads a source has. */
export function blockingKeyCalls(source: string): number {
  return [...source.matchAll(BLOCKING_KEY)].length;
}
