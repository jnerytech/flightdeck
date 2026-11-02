/**
 * Phase 30: the message a webhook target receives for an event, one formatter per target type.
 * The generic target gets a signed JSON envelope; Slack and Discord get their own shapes.
 */
import type { SessionRecap } from "@flightdeck/protocol";

export type WebhookKind =
  | "needs_you"
  | "session_ended"
  | "session_failed"
  | "budget_alert"
  | "pr_watch";

export type WebhookType = "slack" | "discord" | "generic";

/** One thing that happened, neutral of the target it goes to. */
export interface NotifyEvent {
  /** Unique per event; the idempotency key a receiver can use (`X-Flightdeck-Delivery`). */
  id: string;
  kind: WebhookKind;
  host: string;
  project: string | null;
  title: string;
  /** ISO time. */
  at: string;
  summary: SessionRecap | null;
  /** The one-line detail of the event (the question, the threshold, the PR result). */
  detail: string | null;
}

export interface FormattedWebhook {
  headers: Record<string, string>;
  body: string;
}

export interface FormatOptions {
  /** The generic target's signing secret. */
  signingSecret?: string;
  /** Milliseconds now, for the signature timestamp. */
  now?: () => number;
}

export async function formatWebhook(
  _type: WebhookType,
  _event: NotifyEvent,
  _options: FormatOptions = {},
): Promise<FormattedWebhook> {
  return { headers: {}, body: "" };
}
