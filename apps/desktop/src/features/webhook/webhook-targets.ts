/**
 * Phase 30: the webhook targets. The list lives in the app's storage without any secret: the URL
 * and the generic target's signing secret are vault values, kept by reference.
 */
import { z } from "zod";
import { readStored, validItems } from "@/shared/lib/index.ts";
import type { Platform } from "../../platform/types.ts";
import { KIND_LABEL, type WebhookKind } from "./domain/webhook-format.ts";
import {
  checkNtfy,
  checkUrl,
  type TargetErrorCode,
  type TargetInput,
  type TargetStatus,
  type WebhookTarget,
  WebhookTargetError,
} from "./domain/webhook-target.ts";

export {
  type TargetInput,
  type WebhookTarget,
  WebhookTargetError,
} from "./domain/webhook-target.ts";

export type TargetPlatform = Pick<Platform, "storage" | "vault">;

const KEY = "flightdeck.webhooks";
const urlId = (id: string) => `webhook:${id}`;
const signId = (id: string) => `webhook-sign:${id}`;
const KINDS = Object.keys(KIND_LABEL) as [WebhookKind, ...WebhookKind[]];

/** A stored target (#1609); a kind this app does not know is dropped from it, the target stays. */
const Target = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["slack", "discord", "generic", "ntfy"]),
  hostScope: z.string().nullable(),
  kinds: validItems(z.enum(KINDS)),
  clientId: z.string().nullable(),
  enabled: z.boolean(),
  urlHost: z.string(),
  status: z.enum(["new", "ok", "failing"]),
  lastHttpStatus: z.number().nullable(),
  lastAt: z.string().nullable(),
}) satisfies z.ZodType<WebhookTarget>;

/** A new target id. */
export function randomId(): string {
  return crypto.randomUUID();
}

export class WebhookTargets {
  private readonly newId: () => string;
  private readonly clock: () => number;

  constructor(
    private readonly platform: TargetPlatform,
    options: { newId?: () => string; clock?: () => number } = {},
  ) {
    this.newId = options.newId ?? randomId;
    this.clock = options.clock ?? Date.now;
  }

  list(): WebhookTarget[] {
    return readStored(this.platform.storage, KEY, validItems(Target), []);
  }

  private save(targets: WebhookTarget[]): void {
    this.platform.storage.setItem(KEY, JSON.stringify(targets));
  }

  private check(input: { name?: string; kinds?: WebhookKind[] }): void {
    if (input.name?.trim() === "") throw new WebhookTargetError("no_name");
    if (input.kinds?.length === 0) throw new WebhookTargetError("no_kinds");
  }

  async add(input: TargetInput): Promise<WebhookTarget> {
    this.check(input);
    const urlHost = checkUrl(input.url);
    checkNtfy(input.type, input.url, input.signingSecret);
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
    const type = patch.type ?? current.type;
    // A target made ntfy keeps its URL: that one must be a topic too.
    const becomesNtfy = type === "ntfy" && current.type !== "ntfy";
    const url =
      becomesNtfy && patch.url === undefined
        ? await this.platform.vault.get(urlId(id))
        : (patch.url ?? null);
    checkNtfy(type, url, patch.signingSecret);
    if (patch.url !== undefined) await this.platform.vault.set(urlId(id), patch.url);
    if (patch.signingSecret) await this.platform.vault.set(signId(id), patch.signingSecret);
    // Another type's secret is not an ntfy token: it would go out as a Bearer that fails forever.
    else if (becomesNtfy) await this.platform.vault.delete(signId(id));
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
