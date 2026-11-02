/**
 * Phase 30: the webhook targets. The list lives in the app's storage without any secret: the URL
 * and the generic target's signing secret are vault values, kept by reference.
 */
import type { Platform } from "../platform/types.ts";
import type { WebhookKind, WebhookType } from "./webhook-format.ts";

export type TargetStatus = "new" | "ok" | "failing";

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

export type TargetErrorCode = "invalid_url" | "not_https" | "no_kinds" | "no_name" | "not_found";

export class WebhookTargetError extends Error {
  constructor(readonly code: TargetErrorCode) {
    super(code);
  }
}

export type TargetPlatform = Pick<Platform, "storage" | "vault">;

const KEY = "flightdeck.webhooks";
const urlId = (id: string) => `webhook:${id}`;
const signId = (id: string) => `webhook-sign:${id}`;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The host of a URL a target may use: https, or http only to this machine; no credentials. */
function checkUrl(raw: string): string {
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

const isTarget = (value: unknown): value is WebhookTarget =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as WebhookTarget).id === "string" &&
  typeof (value as WebhookTarget).name === "string" &&
  Array.isArray((value as WebhookTarget).kinds);

export class WebhookTargets {
  private readonly newId: () => string;
  private readonly clock: () => number;

  constructor(
    private readonly platform: TargetPlatform,
    options: { newId?: () => string; clock?: () => number } = {},
  ) {
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.clock = options.clock ?? Date.now;
  }

  list(): WebhookTarget[] {
    try {
      const parsed: unknown = JSON.parse(this.platform.storage.getItem(KEY) ?? "[]");
      return Array.isArray(parsed) ? parsed.filter(isTarget) : [];
    } catch {
      return [];
    }
  }

  private save(targets: WebhookTarget[]): void {
    this.platform.storage.setItem(KEY, JSON.stringify(targets));
  }

  private check(input: { name?: string; kinds?: WebhookKind[] }): void {
    if (input.name !== undefined && input.name.trim() === "")
      throw new WebhookTargetError("no_name");
    if (input.kinds !== undefined && input.kinds.length === 0)
      throw new WebhookTargetError("no_kinds");
  }

  async add(input: TargetInput): Promise<WebhookTarget> {
    this.check(input);
    const urlHost = checkUrl(input.url);
    const id = this.newId();
    await this.platform.vault.set(urlId(id), input.url);
    if (input.signingSecret) await this.platform.vault.set(signId(id), input.signingSecret);
    const target: WebhookTarget = {
      id,
      name: input.name.trim(),
      type: input.type,
      hostScope: input.hostScope,
      kinds: input.kinds,
      clientId: input.clientId,
      enabled: true,
      urlHost,
      status: "new",
      lastHttpStatus: null,
      lastAt: null,
    };
    this.save([...this.list(), target]);
    return target;
  }

  async update(
    id: string,
    patch: Partial<TargetInput> & { enabled?: boolean },
  ): Promise<WebhookTarget> {
    const targets = this.list();
    const current = targets.find((t) => t.id === id);
    if (!current) throw new WebhookTargetError("not_found");
    this.check(patch);
    const urlHost = patch.url !== undefined ? checkUrl(patch.url) : current.urlHost;
    if (patch.url !== undefined) await this.platform.vault.set(urlId(id), patch.url);
    if (patch.signingSecret) await this.platform.vault.set(signId(id), patch.signingSecret);
    const next: WebhookTarget = {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.hostScope !== undefined ? { hostScope: patch.hostScope } : {}),
      ...(patch.kinds !== undefined ? { kinds: patch.kinds } : {}),
      ...(patch.clientId !== undefined ? { clientId: patch.clientId } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      urlHost,
      // A new address gets a fresh start; editing a failing target is how it is retried.
      ...(patch.url !== undefined
        ? { status: "new" as const, lastHttpStatus: null, lastAt: null }
        : {}),
    };
    this.save(targets.map((t) => (t.id === id ? next : t)));
    return next;
  }

  async remove(id: string): Promise<void> {
    await this.platform.vault.delete(urlId(id));
    await this.platform.vault.delete(signId(id));
    this.save(this.list().filter((t) => t.id !== id));
  }

  async secrets(id: string): Promise<{ url: string; signingSecret: string | null } | null> {
    const url = await this.platform.vault.get(urlId(id));
    if (url === null) return null;
    return { url, signingSecret: await this.platform.vault.get(signId(id)) };
  }

  record(id: string, result: { ok: boolean; httpStatus: number | null }): void {
    this.save(
      this.list().map((t) =>
        t.id === id
          ? {
              ...t,
              status: result.ok ? "ok" : "failing",
              lastHttpStatus: result.httpStatus,
              lastAt: new Date(this.clock()).toISOString(),
            }
          : t,
      ),
    );
  }

  matching(event: { kind: WebhookKind; hostId: string; clientId: string | null }): WebhookTarget[] {
    return this.list().filter(
      (t) =>
        t.enabled &&
        t.kinds.includes(event.kind) &&
        (t.hostScope === null || t.hostScope === event.hostId) &&
        (t.clientId === null || t.clientId === event.clientId),
    );
  }
}
