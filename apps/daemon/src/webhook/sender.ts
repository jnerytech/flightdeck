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
export function isPublicAddress(_address: string): boolean {
  return false;
}

export class WebhookSender {
  constructor(private readonly options: WebhookSenderOptions = {}) {}

  async send(_request: WebhookRequest, _origin: string): Promise<WebhookOutcome> {
    return { status: 0, retryAfterMs: 0, refused: "" };
  }
}
