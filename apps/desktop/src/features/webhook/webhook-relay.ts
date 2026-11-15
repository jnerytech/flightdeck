import type { HostView } from "../../lib/app-state.ts";
import type { AppKernel } from "../../lib/kernel.ts";
import { hasFeature } from "../../lib/version.ts";
import type { WebhookRequest, WebhookResponse } from "../../platform/types.ts";

/**
 * Phase 30: posts a webhook through an online host that can (the URL goes there for this one use,
 * over the vault's transport). A request the host refuses counts as a permanent 400.
 */
export async function relayWebhook(
  kernel: Pick<AppKernel<{ hosts: HostView[] }>, "state" | "dispatch">,
  request: WebhookRequest,
): Promise<WebhookResponse> {
  const host = kernel
    .state()
    .hosts.find((h) => h.status === "online" && hasFeature(h.hostInfo?.features, "webhook", false));
  if (!host) return { status: null, retryAfterMs: null };
  try {
    const result = await kernel.dispatch(host.id, "webhook.send", request);
    return {
      status: result.refused === null ? result.status : 400,
      retryAfterMs: result.retryAfterMs,
    };
  } catch {
    return { status: null, retryAfterMs: null };
  }
}
