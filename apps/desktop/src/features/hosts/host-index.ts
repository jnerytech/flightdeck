import type { Platform } from "../../platform/types.ts";

/** The last sync of each shell's index: the next one waits for it. */
const lastSync = new WeakMap<object, Promise<void>>();

/**
 * Tells the shell what `flightdeckd --host` reads (#3429): each host's id, name and address, never a token.
 * One at a time and in the order asked, so an older list never lands after a newer one. A shell that
 * cannot write it, or a store that refuses, must not stop the app: the CLI then says "no credential
 * store" itself.
 */
export function syncHostIndex(
  index: Platform["hostIndex"],
  hosts: ReadonlyArray<{ id: string; name: string; url: string }>,
): void {
  if (!index) return;
  const listed = hosts.map(({ id, name, url }) => ({ id, name, url }));
  const before = lastSync.get(index) ?? Promise.resolve();
  lastSync.set(
    index,
    before.then(() => index.sync(listed)).catch(() => {}),
  );
}
