/**
 * The guard behind the webhook sender (#465): what a request may carry (body size, headers) and
 * where it may go (the address check), and how an approved request goes out, pinned to the address
 * the check approved. Pure over its inputs: the DNS lookup, the fetch, the vault and `isIP` (read
 * with `node:net`, passed in as `ipKind`) stay in the sender.
 */
export interface WebhookRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface WebhookOutcome {
  /** `null` when the request got no answer. */
  status: number | null;
  retryAfterMs: number | null;
  /** Why the daemon would not make the request at all. */
  refused: string | null;
}

export const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
export const MAX_BODY = 100_000;
export const HEADER_OK = /^(?:content-type|x-flightdeck-[a-z0-9-]+)$/i;
/** An ntfy access token (#263): the one `Authorization` that goes out, and only in this shape. */
export const BEARER = /^Bearer [A-Za-z0-9_-]{1,200}$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: header values must not carry control characters
export const CONTROL = /[\u0000-\u001f\u007f]/;

/** A request that passed the check: its URL and the address the check approved. */
export interface Checked {
  url: URL;
  address: string;
}

/**
 * The request as it goes out (#465): to the address the check approved, so a name that answers a
 * public address to the check and a private one to a second lookup (DNS rebinding) cannot move it.
 * The name stays in `Host` and, over https, in the TLS server name the certificate is checked for.
 */
export function pinned(
  checked: Checked,
  headers: Record<string, string>,
  ipKind: (text: string) => number,
): { url: string; headers: Record<string, string>; tls: { serverName: string } | null } {
  const { url, address } = checked;
  const name = url.hostname.replace(/^\[|\]$/g, "");
  const target = new URL(url);
  target.hostname = ipKind(address) === 6 ? `[${address}]` : address;
  return {
    url: target.toString(),
    headers: { ...headers, Host: url.host },
    // SNI carries names only: an address written in the URL is checked as the URL's host.
    tls: url.protocol === "https:" && ipKind(name) === 0 ? { serverName: name } : null,
  };
}

export const refuse = (refused: string): WebhookOutcome => ({
  status: null,
  retryAfterMs: null,
  refused,
});

export function retryAfter(value: string | null): number | null {
  const seconds = value === null ? Number.NaN : Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
}
