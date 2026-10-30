/**
 * Phase 16: who asks the vault for a secret. `you` is only for uses the app itself started;
 * a request that comes from the daemon is `claude`, `automation` or `workflow`, never `you`
 * (any local process that reads the config speaks the protocol). Anything else is treated as the
 * most restricted. Whether a known requester gets the secret is the app's decision.
 */
export type Requester = "claude" | "automation" | "workflow" | "unknown";

const DAEMON_REQUESTERS: ReadonlySet<string> = new Set(["claude", "automation", "workflow"]);

/** The requester of a daemon request, from whatever it claimed: `you` and the unknown are `unknown`. */
export function requesterOf(raw: unknown): Requester {
  return typeof raw === "string" && DAEMON_REQUESTERS.has(raw) ? (raw as Requester) : "unknown";
}

export type RequestDecision =
  | { granted: true; requester: Exclude<Requester, "unknown">; reason: string }
  | { granted: false; requester: Requester; reason: string };

/**
 * The answer to a `vault.request` of the daemon: a known requester may ask, and the app decides
 * (it asks you, or follows the action's approval); `you`, which only the app is, and anything
 * unknown are refused.
 */
export function decideRequest(raw: { requester?: unknown }): RequestDecision {
  const requester = requesterOf(raw.requester);
  if (requester === "unknown") {
    return {
      granted: false,
      requester,
      reason: "só o Claude, uma automação ou um workflow pedem segredos ao app por este caminho",
    };
  }
  return { granted: true, requester, reason: "o app decide se entrega o segredo" };
}
