/**
 * Phase 30: turns what the app sees (a permission asked, a session that ended, a budget threshold,
 * a PR watch that needs you) into events for the webhooks. It is not tied to the window being in
 * focus: a webhook is for when the person is away.
 */
import type { ExternalPermissionFrame, ExternalSession, WatchInfo } from "@flightdeck/protocol";
import { translator } from "../i18n/index.ts";
import type { SidebarSession } from "./app-store.ts";
import type { WebhookSource, Webhooks } from "./webhooks.ts";

/** Messages that leave the app are in English, whatever the app's language. */
const EN = translator("en");

export interface FeedHost {
  id: string;
  name: string;
}

const basename = (path: string | null): string | null =>
  path?.split(/[\\/]/).filter(Boolean).pop() ?? null;

export class WebhookFeed {
  constructor(
    private readonly webhooks: Pick<Webhooks, "emit">,
    private readonly clientOf: (hostId: string, cwd: string | null) => string | null,
    private readonly now: () => number = Date.now,
  ) {}

  private send(
    host: FeedHost,
    source: Omit<WebhookSource, "hostId" | "hostName" | "project" | "detail" | "clientId"> &
      Partial<WebhookSource>,
  ): void {
    void this.webhooks.emit({
      hostId: host.id,
      hostName: host.name,
      clientId: null,
      project: null,
      detail: null,
      ...source,
    });
  }

  /** A managed session's summary changed: new permission requests, and a session that ended or failed. */
  managed(host: FeedHost, prev: SidebarSession | undefined, next: SidebarSession): void {
    if (!prev) return;
    const title = next.name ?? basename(next.cwd) ?? next.id;
    const clientId = this.clientOf(host.id, next.cwd);
    const known = new Set(prev.pendingPermissions.map((p) => p.requestId));
    for (const request of next.pendingPermissions.filter((p) => !known.has(p.requestId))) {
      this.send(host, {
        id: `${host.id}/${request.requestId}`,
        kind: "needs_you",
        clientId,
        title,
        detail: EN("webhookMsg.allow", { tool: request.toolName }),
      });
    }
    if (prev.status !== next.status && (next.status === "ended" || next.status === "error")) {
      this.send(host, {
        id: `${host.id}/${next.id}/${next.status}`,
        kind: next.status === "ended" ? "session_ended" : "session_failed",
        clientId,
        title,
      });
    }
  }

  externalPermission(host: FeedHost, frame: ExternalPermissionFrame, cwd: string | null): void {
    if (frame.state !== "open") return;
    this.send(host, {
      id: `${host.id}/${frame.requestId}`,
      kind: "needs_you",
      clientId: this.clientOf(host.id, cwd),
      title: basename(cwd) ?? frame.claudeSessionId,
      detail: EN("webhookMsg.allow", { tool: frame.toolName }),
      claudeSessionId: frame.claudeSessionId,
    });
  }

  externalSession(host: FeedHost, prev: ExternalSession | undefined, next: ExternalSession): void {
    if (!prev || prev.status === "ended" || next.status !== "ended") return;
    this.send(host, {
      id: `${host.id}/${next.claudeSessionId}/ended`,
      kind: "session_ended",
      clientId: this.clientOf(host.id, next.cwd),
      project: next.projectKey,
      title: next.meta?.name ?? basename(next.cwd) ?? next.claudeSessionId,
      claudeSessionId: next.claudeSessionId,
    });
  }

  budget(host: FeedHost, label: string, percent: number, limit: string): void {
    this.send(host, {
      id: `${host.id}/budget/${this.now()}`,
      kind: "budget_alert",
      title: label,
      detail: EN("webhookMsg.percentOf", { percent, limit }),
    });
  }

  clientBudget(name: string, clientId: string, percent: number, limit: string): void {
    void this.webhooks.emit({
      id: `client/${clientId}/${this.now()}`,
      kind: "budget_alert",
      hostId: "",
      hostName: "Flightdeck",
      clientId,
      project: null,
      title: name,
      detail: EN("webhookMsg.percentOf", { percent, limit }),
    });
  }

  watch(host: FeedHost, title: string, before: WatchInfo | undefined, watch: WatchInfo): void {
    if (watch.status !== "needs_you" || before?.status === "needs_you") return;
    this.send(host, {
      id: `${host.id}/${watch.cardId}/watch/${this.now()}`,
      kind: "pr_watch",
      title,
      detail: watch.reason,
    });
  }
}
