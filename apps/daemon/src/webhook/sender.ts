import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { requireVaultTransport } from "../vault/index.ts";
import { isLoopbackIp, isPublicIp } from "./domain/address.ts";

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

/** Whether an address is one a webhook may be sent to: not private, link-local, loopback or reserved. */
export const isPublicAddress = (address: string): boolean => isPublicIp(address, isIP(address));
const isLoopback = (address: string): boolean => isLoopbackIp(address, isIP(address));

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
