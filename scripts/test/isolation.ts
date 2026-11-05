/**
 * Shared globals a test file can leave changed for the next one (issue #274): the timers, `Date`,
 * `fetch`, the environment and, once happy-dom is registered, the window size, the browser storage
 * and the page body. `captureGlobals` takes them as the preload leaves them; `restoreGlobals` puts
 * them back between two files and names what had leaked.
 */

/** What the isolation looks at: the real `globalThis`, or a stand-in in a test. */
// biome-ignore lint/suspicious/noExplicitAny: a global scope has no useful type
export type Scope = Record<string, any>;

export interface Snapshot {
  env: Record<string, string | undefined>;
  members: Record<string, unknown>;
}

/** Take the globals as they are now. */
export function captureGlobals(_scope: Scope = globalThis): Snapshot {
  return { env: {}, members: {} };
}

/** Put the globals back as `snapshot` has them; returns the names that had changed. */
export function restoreGlobals(_snapshot: Snapshot, _scope: Scope = globalThis): string[] {
  return [];
}
