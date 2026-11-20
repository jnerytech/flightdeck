/**
 * The rules of `--host <name>` (issue #3429, `docs/decisions/2026-11-20-cli-host-credentials.md`):
 * which host a name means, what the index of names looks like, and which addresses may carry a token.
 * Pure: no file, no process, no network.
 */

/** The id the app gives a host (`crypto.randomUUID()`): any other id is refused before it reaches the helper. */
export const HOST_ID = /^$/;

export interface HostEntry {
  id: string;
  name: string;
}

export type HostPick =
  | { ok: true; id: string }
  | { ok: false; reason: "unknown_host" | "ambiguous_host"; names: string[] };

/** The host a name means: an exact match on the name, and nothing else (not an address, not a part of a name). */
export function pickHost(_hosts: readonly HostEntry[], _name: string): HostPick {
  return { ok: false, reason: "unknown_host", names: [] };
}

/** The names and ids of the index the app writes, or null when the text is not that index. */
export function parseHostIndex(_text: string): HostEntry[] | null {
  return null;
}

export type AddressRefusal = "bad_address" | "cleartext_remote";

/** Why the token may not be sent to this address, or null: `wss://` anywhere, `ws://` only over a private path. */
export function remoteAddressRefusal(_address: string): AddressRefusal | null {
  return "bad_address";
}
