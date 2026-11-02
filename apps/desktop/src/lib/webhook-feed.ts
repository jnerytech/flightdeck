/**
 * Phase 30: turns what the app sees (a permission asked, a session that ended, a budget threshold,
 * a PR watch that needs you) into events for the webhooks. It is not tied to the window being in
 * focus: a webhook is for when the person is away.
 */
import type { ExternalPermissionFrame, ExternalSession, WatchInfo } from "@flightdeck/protocol";
import type { SidebarSession } from "./app-store.ts";
import type { Webhooks } from "./webhooks.ts";

export interface FeedHost {
  id: string;
  name: string;
}

export class WebhookFeed {
  constructor(
    _webhooks: Pick<Webhooks, "emit">,
    _clientOf: (hostId: string, cwd: string | null) => string | null,
    _now: () => number = Date.now,
  ) {}

  /** A managed session's summary changed: new permission requests, and a session that ended or failed. */
  managed(_host: FeedHost, _prev: SidebarSession | undefined, _next: SidebarSession): void {}

  externalPermission(_host: FeedHost, _frame: ExternalPermissionFrame, _cwd: string | null): void {}

  externalSession(
    _host: FeedHost,
    _prev: ExternalSession | undefined,
    _next: ExternalSession,
  ): void {}

  budget(_host: FeedHost, _label: string, _percent: number, _limit: string): void {}

  clientBudget(_name: string, _clientId: string, _percent: number, _limit: string): void {}

  watch(_host: FeedHost, _title: string, _before: WatchInfo | undefined, _watch: WatchInfo): void {}
}
