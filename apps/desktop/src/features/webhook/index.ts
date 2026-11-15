/**
 * The webhook's public entry for state and wiring (#1589): the host call that relays a post.
 * Components come from `ui.ts`, so this file re-exports none (#2451).
 */
export { relayWebhook } from "./webhook-relay.ts";
