/**
 * Phase 30: ties the pieces together. An event of the app goes to the targets that want it,
 * through the queue, formatted for each; a test sends a sample straight away.
 */
import type { SessionRecap } from "@flightdeck/protocol";
import type { Platform } from "../platform/types.ts";
import { formatWebhook, type NotifyEvent, type WebhookKind } from "./webhook-format.ts";
import { type SendResult, WebhookQueue } from "./webhook-queue.ts";
import { WebhookTargets } from "./webhook-targets.ts";

/** What the app knows when something happens; the id is the event's identity, so a replay is dropped. */
export interface WebhookSource {
  id: string;
  kind: WebhookKind;
  hostId: string;
  hostName: string;
  clientId: string | null;
  project: string | null;
  title: string;
  detail: string | null;
  /** When present, the session's summary is added to the message. */
  claudeSessionId?: string | null;
}

export interface WebhooksOptions {
  platform: Pick<Platform, "storage" | "vault" | "webhookSend">;
  summaryFor?: (
    hostId: string,
    claudeSessionId: string,
    extra: { question?: string },
  ) => Promise<SessionRecap | null>;
  now?: () => number;
  newId?: () => string;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/** Ids of events already handled, kept so a replay (a reconnect, a repeated frame) sends nothing twice. */
const SEEN_MAX = 500;

export class Webhooks {
  readonly targets: WebhookTargets;
  private readonly queue: WebhookQueue;
  private readonly seen = new Set<string>();
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly options: WebhooksOptions) {
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.targets = new WebhookTargets(options.platform, {
      newId: this.newId,
      clock: this.now,
    });
    this.queue = new WebhookQueue({
      send: (targetId, event) => this.post(targetId, event),
      onResult: (targetId, result) => this.targets.record(targetId, result),
      sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      now: this.now,
      ...(options.random ? { random: options.random } : {}),
    });
  }

  /** Whether this build can send at all (the web build cannot). */
  supported(): boolean {
    return this.options.platform.webhookSend !== undefined;
  }

  /** One post of an event to one target; `status: null` when it could not be made. */
  private async post(targetId: string, event: NotifyEvent): Promise<SendResult> {
    const send = this.options.platform.webhookSend;
    const target = this.targets.list().find((t) => t.id === targetId);
    const secrets = await this.targets.secrets(targetId);
    if (!send || !target || !secrets) return { status: null };
    const message = await formatWebhook(target.type, event, {
      ...(secrets.signingSecret ? { signingSecret: secrets.signingSecret } : {}),
      now: this.now,
    });
    const response = await send({ url: secrets.url, headers: message.headers, body: message.body });
    return { status: response.status, retryAfterMs: response.retryAfterMs };
  }

  async emit(source: WebhookSource): Promise<void> {
    if (!this.supported() || this.seen.has(source.id)) return;
    this.seen.add(source.id);
    if (this.seen.size > SEEN_MAX) this.seen.delete(this.seen.values().next().value as string);
    const matching = this.targets.matching({
      kind: source.kind,
      hostId: source.hostId,
      clientId: source.clientId,
    });
    if (matching.length === 0) return;
    let summary: SessionRecap | null = null;
    if (source.claudeSessionId && this.options.summaryFor) {
      try {
        summary = await this.options.summaryFor(source.hostId, source.claudeSessionId, {
          ...(source.detail ? { question: source.detail } : {}),
        });
      } catch {
        summary = null;
      }
    }
    const event: NotifyEvent = {
      id: source.id,
      kind: source.kind,
      host: source.hostName,
      project: source.project,
      title: source.title,
      at: new Date(this.now()).toISOString(),
      summary,
      detail: source.detail,
    };
    for (const target of matching) this.queue.enqueue(target.id, event);
  }

  /** Sends a sample event to one target now, one try; the answer is the status and the time. */
  async test(targetId: string): Promise<{ ok: boolean; httpStatus: number | null; at: string }> {
    const at = new Date(this.now()).toISOString();
    const sample: NotifyEvent = {
      id: `test-${this.newId()}`,
      kind: "needs_you",
      host: "Flightdeck",
      project: null,
      title: "Flightdeck test",
      at,
      summary: null,
      detail: "This is a test message.",
    };
    let status: number | null = null;
    try {
      status = (await this.post(targetId, sample)).status;
    } catch {
      status = null;
    }
    const ok = status !== null && status >= 200 && status < 300;
    this.targets.record(targetId, { ok, httpStatus: status });
    if (ok) this.queue.unblock(targetId);
    return { ok, httpStatus: status, at };
  }

  async idle(): Promise<void> {
    await this.queue.idle();
  }
}
