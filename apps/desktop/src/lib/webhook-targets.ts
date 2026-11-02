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

export class WebhookTargets {
  constructor(
    _platform: TargetPlatform,
    _options: { newId?: () => string; clock?: () => number } = {},
  ) {}

  list(): WebhookTarget[] {
    return [{} as WebhookTarget];
  }

  async add(_input: TargetInput): Promise<WebhookTarget> {
    return {} as WebhookTarget;
  }

  async update(
    _id: string,
    _patch: Partial<TargetInput> & { enabled?: boolean },
  ): Promise<WebhookTarget> {
    return {} as WebhookTarget;
  }

  async remove(_id: string): Promise<void> {}

  async secrets(_id: string): Promise<{ url: string; signingSecret: string | null } | null> {
    return { url: "", signingSecret: "" };
  }

  record(_id: string, _result: { ok: boolean; httpStatus: number | null }): void {}

  matching(_event: {
    kind: WebhookKind;
    hostId: string;
    clientId: string | null;
  }): WebhookTarget[] {
    return [{} as WebhookTarget];
  }
}
