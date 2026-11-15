import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { requireVaultTransport } from "../vault/index.ts";
import { isLoopbackIp, isPublicIp } from "./domain/address.ts";
import {
  BEARER,
  type Checked,
  CONTROL,
  HEADER_OK,
  LOOPBACK_NAMES,
  MAX_BODY,
  pinned,
  refuse,
  retryAfter,
  type WebhookOutcome,
  type WebhookRequest,
} from "./domain/webhook-guard.ts";

/**
 * Phase 30: posts a webhook for the app. The URL is the secret (Slack and Discord put the token in
 * it), so it arrives for one use over the vault's transport, is never stored or logged, and only
 * the status goes back.
 */

/** Whether an address is one a webhook may be sent to: not private, link-local, loopback or reserved. */
export const isPublicAddress = (address: string): boolean => isPublicIp(address, isIP(address));
const isLoopback = (address: string): boolean => isLoopbackIp(address, isIP(address));

type Resolver = (host: string) => Promise<string[]>;

export interface WebhookSenderOptions {
  resolve?: Resolver;
  fetch?: typeof fetch;
  timeoutMs?: number;
  log?: (message: string) => void;
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
    const { url, headers, tls } = pinned(checked, request.headers, isIP);
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
