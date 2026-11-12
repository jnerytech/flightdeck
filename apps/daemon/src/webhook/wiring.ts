import type { DomainModule } from "../server/index.ts";
import { WebhookSender, type WebhookSenderOptions } from "./sender.ts";

/** The sender of the host's webhook calls (the board's and the automations'), checked before it connects. */
export function createWebhook(options: WebhookSenderOptions) {
  const module: DomainModule<"webhook"> = { server: { webhook: new WebhookSender(options) } };
  return { modules: [module] as const };
}
