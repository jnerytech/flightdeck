/**
 * Phase 30: ties the pieces together. An event of the app goes to the targets that want it,
 * through the queue, formatted for each; a test sends a sample straight away.
 */
import type { SessionRecap } from "@flightdeck/protocol";
import type { Platform } from "../platform/types.ts";
import type { WebhookKind } from "./webhook-format.ts";
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

export class Webhooks {
  readonly targets: WebhookTargets;

  constructor(options: WebhooksOptions) {
    this.targets = new WebhookTargets(options.platform, {
      ...(options.newId ? { newId: options.newId } : {}),
    });
  }

  /** Whether this build can send at all (the web build cannot). */
  supported(): boolean {
    return true;
  }

  async emit(_source: WebhookSource): Promise<void> {}

  /** Sends a sample event to one target now, one try; the answer is the status and the time. */
  async test(_targetId: string): Promise<{ ok: boolean; httpStatus: number | null; at: string }> {
    return { ok: false, httpStatus: 0, at: "" };
  }

  async idle(): Promise<void> {}
}
