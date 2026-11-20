import type { Platform } from "../../platform/types.ts";

/**
 * Tells the shell what `flightdeckd --host` reads (#3429): each host's id, name and address, never a token.
 * A shell that cannot write it, or a store that refuses, must not stop the app: the CLI then says
 * "no credential store" itself.
 */
export function syncHostIndex(
  index: Platform["hostIndex"],
  hosts: ReadonlyArray<{ id: string; name: string; url: string }>,
): void {
  index?.sync(hosts.map(({ id, name, url }) => ({ id, name, url }))).catch(() => {});
}
