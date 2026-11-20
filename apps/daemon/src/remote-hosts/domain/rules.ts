/**
 * The rules of `--host <name>` (issue #3429, `docs/decisions/2026-11-20-cli-host-credentials.md`):
 * which host a name means, what the index of names looks like, and which addresses may carry a token.
 * Pure: no file, no process, no network.
 */
import { WS_PATH } from "@flightdeck/protocol";
import { z } from "zod";
import { ipInNetworks, parseJsonOr } from "../../kernel/index.ts";

/** The id the app gives a host (`crypto.randomUUID()`): any other id is refused before it reaches the helper. */
export const HOST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface HostEntry {
  id: string;
  name: string;
}

export type HostPick =
  | { ok: true; id: string }
  | { ok: false; reason: "unknown_host" | "ambiguous_host"; names: string[] };

/** Each name once, in a stable order: what an error lists, so a person can pick one. */
const sortedNames = (hosts: readonly HostEntry[]) =>
  [...new Set(hosts.map((h) => h.name))].sort((a, b) => a.localeCompare(b, "en"));

/** The host a name means: an exact match on the name, and nothing else (not an address, not a part of a name). */
export function pickHost(hosts: readonly HostEntry[], name: string): HostPick {
  // An entry whose id is not a UUID is not a host: its id never reaches the helper.
  const known = hosts.filter((host) => HOST_ID.test(host.id));
  const matches = known.filter((host) => host.name === name);
  const [only, ...others] = matches;
  if (only && others.length === 0) return { ok: true, id: only.id };
  return {
    ok: false,
    reason: only ? "ambiguous_host" : "unknown_host",
    names: sortedNames(known),
  };
}

/** Only the id and the name are read: whatever else the file holds is never carried on. */
const HostIndex = z.object({
  hosts: z.array(
    z.object({ id: z.string(), name: z.string() }).transform(({ id, name }) => ({ id, name })),
  ),
});

/** The names and ids of the index the app writes, or null when the text is not that index. */
export function parseHostIndex(text: string): HostEntry[] | null {
  return parseJsonOr(HostIndex, text, null)?.hosts ?? null;
}

export type AddressRefusal = "bad_address" | "cleartext_remote";

/** Loopback, the private ranges, the shared range of Tailscale (100.64/10) and the unique-local and link-local IPv6 ranges. */
const PRIVATE_NETWORKS = [
  "127.0.0.0/8",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
];

/** A name that stays on this machine or on the tailnet; a trailing dot makes it another name. */
const privateName = (host: string) =>
  host === "localhost" || /^[^.]+(\.[^.]+)*\.ts\.net$/.test(host);

/** Why the token may not be sent to this address, or null: `wss://` anywhere, `ws://` only over a private path. */
export function remoteAddressRefusal(address: string): AddressRefusal | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return "bad_address";
  }
  const secure = url.protocol === "wss:";
  const shape =
    (secure || url.protocol === "ws:") &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === WS_PATH &&
    url.search === "" &&
    url.hash === "";
  if (!shape) return "bad_address";
  if (secure) return null;
  // The URL parser has already turned decimal, octal and hex IPv4 literals into dotted form.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return privateName(host) || ipInNetworks(host, PRIVATE_NETWORKS) ? null : "cleartext_remote";
}
