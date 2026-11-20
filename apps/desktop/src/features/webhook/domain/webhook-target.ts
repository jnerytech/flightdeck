/**
 * Phase 30: what a webhook target is and which URL it may call: https, or http only to this machine,
 * no credentials; an ntfy target's URL is one topic and its token has ntfy's shape. Pure over a
 * string (`new URL` only): the list in storage and the vault references stay in `../webhook-targets.ts`.
 */
import { ntfyTopic, type WebhookKind, type WebhookType } from "./webhook-format.ts";

type TargetStatus = "new" | "ok" | "failing";

export interface WebhookTarget {
  id: string;
  name: string;
  type: WebhookType;
  /** The host that must have raised the event; `null` for every host. */
  hostScope: string | null;
  kinds: WebhookKind[];
  /** Only events of this client (phase 29); `null` for all. */
  clientId: string | null;
  enabled: boolean;
  /** Only the host name of the URL: the rest of it is the secret. */
  urlHost: string;
  status: TargetStatus;
  lastHttpStatus: number | null;
  lastAt: string | null;
}

export interface TargetInput {
  name: string;
  type: WebhookType;
  url: string;
  signingSecret?: string;
  hostScope: string | null;
  kinds: WebhookKind[];
  clientId: string | null;
}

export type TargetErrorCode =
  | "invalid_url"
  | "not_https"
  | "no_kinds"
  | "no_name"
  | "not_found"
  | "invalid_topic"
  | "invalid_token";

export class WebhookTargetError extends Error {
  constructor(readonly code: TargetErrorCode) {
    super(code);
  }
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The host of a URL a target may use: https, or http only to this machine; no credentials. */
export function checkUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookTargetError("invalid_url");
  }
  if (url.username || url.password) throw new WebhookTargetError("invalid_url");
  const secure = url.protocol === "https:";
  if (!secure && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) {
    throw new WebhookTargetError(
      url.protocol === "http:" || url.protocol === "ftp:" ? "not_https" : "invalid_url",
    );
  }
  return url.hostname.replace(/^\[|\]$/g, "");
}

/** An ntfy access token as ntfy issues it (`tk_…`), and as the daemon lets it through (#263). */
const NTFY_TOKEN = /^[A-Za-z0-9_-]{1,200}$/;

/** An ntfy target's URL is one topic on a server, and its token has ntfy's shape. */
export function checkNtfy(type: WebhookType, url: string | null, token: string | undefined): void {
  if (type !== "ntfy") return;
  if (url !== null && !ntfyTopic(url)) throw new WebhookTargetError("invalid_topic");
  if (token && !NTFY_TOKEN.test(token)) throw new WebhookTargetError("invalid_token");
}
