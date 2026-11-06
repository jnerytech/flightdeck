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

export const KIND_LABEL: Record<WebhookKind, string> = {
  needs_you: "needs you",
  session_ended: "session ended",
  session_failed: "session failed",
  budget_alert: "budget alert",
  pr_watch: "PR watch",
};

const JSON_HEADERS = { "Content-Type": "application/json" };

const cut = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

/** The lines of the summary, plain text, in the order a person reads them. */
function summaryLines(event: NotifyEvent): string[] {
  const { summary, detail } = event;
  const lines: string[] = [];
  if (summary?.asked) lines.push(`Asked: ${summary.asked}`);
  if (summary?.done) lines.push(`Done: ${summary.done}`);
  if (summary && summary.files.length > 0) {
    const more = summary.filesMore > 0 ? ` and ${summary.filesMore} more` : "";
    lines.push(`Files: ${summary.files.join(", ")}${more}`);
  }
  if (summary?.costUsd != null) lines.push(`Cost: $${summary.costUsd.toFixed(2)}`);
  const question = detail ?? summary?.question;
  if (question) lines.push(`Question: ${question}`);
  return lines;
}

const headline = (event: NotifyEvent): string =>
  `${KIND_LABEL[event.kind]}: ${event.title} (${event.host})`;

const slackEscape = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function slack(event: NotifyEvent): FormattedWebhook {
  const title = slackEscape(headline(event));
  const body = summaryLines(event).map(slackEscape).join("\n");
  const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text: `*${title}*` } }];
  if (body) blocks.push({ type: "section", text: { type: "mrkdwn", text: cut(body, 3000) } });
  return { headers: JSON_HEADERS, body: JSON.stringify({ text: title, blocks }) };
}

/** A zero-width space after `@` stops `@everyone`, `@here` and `<@id>` from pinging. */
const discordSafe = (value: string): string => value.replaceAll("@", "@\u200b");

function discord(event: NotifyEvent): FormattedWebhook {
  const body = {
    content: cut(discordSafe(`${KIND_LABEL[event.kind]} (${event.host})`), 2000),
    embeds: [
      {
        title: cut(discordSafe(event.title), 256),
        description: cut(discordSafe(summaryLines(event).join("\n")), 4096),
        timestamp: event.at,
      },
    ],
    allowed_mentions: { parse: [] as string[] },
  };
  return { headers: JSON_HEADERS, body: JSON.stringify(body) };
}

async function hmacHex(secret: string, text: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(text));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function generic(event: NotifyEvent, options: FormatOptions): Promise<FormattedWebhook> {
  const body = JSON.stringify({
    id: event.id,
    kind: event.kind,
    host: event.host,
    project: event.project,
    title: event.title,
    at: event.at,
    detail: event.detail,
    summary: event.summary,
  });
  const timestamp = String(Math.floor((options.now ?? Date.now)() / 1000));
  const headers: Record<string, string> = {
    ...JSON_HEADERS,
    "X-Flightdeck-Event": event.kind,
    "X-Flightdeck-Delivery": event.id,
    "X-Flightdeck-Timestamp": timestamp,
  };
  if (options.signingSecret) {
    headers["X-Flightdeck-Signature"] =
      "sha256=" + (await hmacHex(options.signingSecret, timestamp + "." + body));
  }
  return { headers, body };
}

export async function formatWebhook(
  type: WebhookType,
  event: NotifyEvent,
  options: FormatOptions = {},
): Promise<FormattedWebhook> {
  if (type === "slack") return slack(event);
  if (type === "discord") return discord(event);
  return generic(event, options);
}
