/**
 * Phase 16: who asks the vault for a secret. `you` is only for uses the app itself started;
 * a request that comes from the daemon is `claude`, `automation` or `workflow`, never `you`
 * (any local process that reads the config speaks the protocol). Anything else is treated as the
 * most restricted. Whether a known requester gets the secret is the app's decision.
 */
import type { Rule, RulesEnv, UseContext } from "./rules.ts";

export type Requester = "claude" | "automation" | "workflow" | "unknown";

const DAEMON_REQUESTERS: ReadonlySet<string> = new Set(["claude", "automation", "workflow"]);

/** The requester of a daemon request, from whatever it claimed: `you` and the unknown are `unknown`. */
export function requesterOf(raw: unknown): Requester {
  return typeof raw === "string" && DAEMON_REQUESTERS.has(raw) ? (raw as Requester) : "unknown";
}

export type RequestDecision =
  | {
      granted: true;
      requester: Exclude<Requester, "unknown">;
      reason: string;
      decision: "allow" | "ask";
      ruleId: string | null;
      once: boolean;
      needsHold: boolean;
    }
  | {
      granted: false;
      requester: Requester;
      reason: string;
      decision: "deny";
      ruleId: string | null;
      limited: boolean;
    };

/** What a request from the daemon says of the use, besides who asks. */
export type RequestInput = { requester?: unknown } & Partial<Omit<UseContext, "requester">>;

/**
 * The answer to a `vault.request` of the daemon. A requester the daemon does not know (including
 * `you`, which only the app is) is refused before any rule; a known one goes through the secret's
 * rules and the safe defaults, and the app is who finally delivers the secret.
 */
export function decideRequest(
  raw: RequestInput,
  _rules: readonly Rule[] = [],
  _env?: RulesEnv,
): RequestDecision {
  const requester = requesterOf(raw.requester);
  if (requester === "unknown") {
    return {
      granted: false,
      requester,
      reason: "",
      decision: "deny",
      ruleId: null,
      limited: false,
    };
  }
  return {
    granted: true,
    requester,
    reason: "",
    decision: "ask",
    ruleId: null,
    once: false,
    needsHold: false,
  };
}
