import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { requireVaultTransport } from "../vault/vault.ts";

/**
 * Phase 30: posts a webhook for the app. The URL is the secret (Slack and Discord put the token in
 * it), so it arrives for one use over the vault's transport, is never stored or logged, and only
 * the status goes back.
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

export type Resolver = (host: string) => Promise<string[]>;

export interface WebhookSenderOptions {
  resolve?: Resolver;
  fetch?: typeof fetch;
  timeoutMs?: number;
  log?: (message: string) => void;
}

function ipv4Public(octets: number[]): boolean {
  const [a, b] = octets as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

/** The eight 16-bit groups of an IPv6 address; the dotted tail of a mapped IPv4 becomes two groups. */
function groupsOf(address: string): number[] {
  let text = address;
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (tail) {
    const [, a, b, c, d] = tail.map(Number) as [number, number, number, number, number];
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", rest] = text.split("::");
  const front = head === "" ? [] : head.split(":");
  const back = rest === undefined || rest === "" ? [] : rest.split(":");
  const fill = rest === undefined ? 0 : 8 - front.length - back.length;
  return [...front, ...Array(fill).fill("0"), ...back].map((group) => Number.parseInt(group, 16));
}

/** Whether an address is one a webhook may be sent to: not private, link-local, loopback or reserved. */
export function isPublicAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return ipv4Public(address.split(".").map(Number));
  if (kind !== 6) return false;
  const g = groupsOf(address);
  const [g0 = 0, , , , , g5 = 0, g6 = 0, g7 = 0] = g;
  if (g.slice(0, 5).every((group) => group === 0) && g5 === 0xffff) {
    return ipv4Public([g6 >> 8, g6 & 255, g7 >> 8, g7 & 255]);
  }
  if (g.every((group) => group === 0) || (g.slice(0, 7).every((x) => x === 0) && g7 === 1)) {
    return false;
  }
  return (g0 & 0xfe00) !== 0xfc00 && (g0 & 0xffc0) !== 0xfe80 && (g0 & 0xff00) !== 0xff00;
}

const isLoopback = (address: string): boolean => {
  if (isIP(address) === 4) return address.startsWith("127.");
  const g = isIP(address) === 6 ? groupsOf(address) : [];
  return g.length === 8 && g.slice(0, 7).every((x) => x === 0) && g[7] === 1;
};

const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MAX_BODY = 100_000;
const HEADER_OK = /^(?:content-type|x-flightdeck-[a-z0-9-]+)$/i;
/** An ntfy access token (#263): the one `Authorization` that goes out, and only in this shape. */
const BEARER = /^Bearer [A-Za-z0-9_-]{1,200}$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: header values must not carry control characters
const CONTROL = /[\u0000-\u001f\u007f]/;

/** A request that passed the check: its URL and the address the check approved. */
interface Checked {
  url: URL;
  address: string;
}

/**
 * The request as it goes out (#465): to the address the check approved, so a name that answers a
 * public address to the check and a private one to a second lookup (DNS rebinding) cannot move it.
 * The name stays in `Host` and, over https, in the TLS server name the certificate is checked for.
 */
function pinned(
  checked: Checked,
  headers: Record<string, string>,
): { url: string; headers: Record<string, string>; tls: { serverName: string } | null } {
  const { url, address } = checked;
  const name = url.hostname.replace(/^\[|\]$/g, "");
  const target = new URL(url);
  target.hostname = isIP(address) === 6 ? `[${address}]` : address;
  return {
    url: target.toString(),
    headers: { ...headers, Host: url.host },
    // SNI carries names only: an address written in the URL is checked as the URL's host.
    tls: url.protocol === "https:" && isIP(name) === 0 ? { serverName: name } : null,
  };
}

const refuse = (refused: string): WebhookOutcome => ({ status: null, retryAfterMs: null, refused });

function retryAfter(value: string | null): number | null {
  const seconds = value === null ? Number.NaN : Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
}

export class WebhookSender {
  constructor(private readonly options: WebhookSenderOptions = {}) {}

  private async addressesOf(host: string): Promise<string[]> {
    if (isIP(host) !== 0) return [host];
    try {
      if (this.options.resolve) return await this.options.resolve(host);
      return (await lookup(host, { all: true })).map((entry) => entry.address);
    } catch {
      return [];
    }
  }

  /** Why a request must not go out, or `null`. The URL never reaches a log line. */
  private async check(request: WebhookRequest): Promise<Checked | string> {
    if (Buffer.byteLength(request.body) > MAX_BODY) return "body_too_large";
    for (const [name, value] of Object.entries(request.headers)) {
      const allowed = /^authorization$/i.test(name) ? BEARER.test(value) : HEADER_OK.test(name);
      if (!allowed || CONTROL.test(value)) return "bad_header";
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return "invalid_url";
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return "invalid_url";
    if (url.username || url.password) return "credentials";
    const loopbackOnly = url.protocol === "http:";
    if (loopbackOnly && !LOOPBACK_NAMES.has(url.hostname)) return "not_https";
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = await this.addressesOf(host);
    if (addresses.length === 0) return "unresolved";
    const allowed = loopbackOnly ? isLoopback : isPublicAddress;
    if (!addresses.every(allowed)) return "private_address";
    // IPv4 first: a loopback name answers ::1 too, and the old fetch would have tried both.
    const address = addresses.find((a) => isIP(a) === 4) ?? (addresses[0] as string);
    return { url, address };
  }

  async send(request: WebhookRequest, origin: string): Promise<WebhookOutcome> {
    requireVaultTransport(origin, "webhook.send", this.options.log);
    const checked = await this.check(request);
    if (typeof checked === "string") {
      this.options.log?.(`webhook: send refused (${checked})`);
      return refuse(checked);
    }
    const send = this.options.fetch ?? fetch;
    const { url, headers, tls } = pinned(checked, request.headers);
    try {
      const response = await send(url, {
        method: "POST",
        headers,
        body: request.body,
        redirect: "manual",
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
        ...(tls ? { tls } : {}),
      } as RequestInit);
      return {
        status: response.status,
        retryAfterMs: retryAfter(response.headers.get("Retry-After")),
        refused: null,
      };
    } catch {
      return { status: null, retryAfterMs: null, refused: null };
    }
  }
}
