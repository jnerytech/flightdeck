/**
 * Phase 16: who asks the vault for a secret. `you` is only for uses the app itself started;
 * a request that comes from the daemon is `claude`, `automation` or `workflow`, never `you`
 * (any local process that reads the config speaks the protocol). Anything else is treated as the
 * most restricted. Whether a known requester gets the secret is the app's decision.
 */
import { evaluate, localTime, type Rule, type RulesEnv, type UseContext } from "./rules.ts";

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
  rules: readonly Rule[] = [],
  env: RulesEnv = systemEnv(),
): RequestDecision {
  const requester = requesterOf(raw.requester);
  if (requester === "unknown") {
    return {
      granted: false,
      requester,
      reason: "só o Claude, uma automação ou um workflow pedem segredos ao app por este caminho",
      decision: "deny",
      ruleId: null,
      limited: false,
    };
  }
  const use: UseContext = {
    secretId: raw.secretId ?? "",
    purpose: raw.purpose ?? "action",
    host: raw.host ?? "",
    tags: raw.tags ?? [],
    ...(raw.action !== undefined ? { action: raw.action } : {}),
    ...(raw.project !== undefined ? { project: raw.project } : {}),
    ...(raw.session !== undefined ? { session: raw.session } : {}),
    ...(raw.risk !== undefined ? { risk: raw.risk } : {}),
    ...(raw.actionApproval !== undefined ? { actionApproval: raw.actionApproval } : {}),
    requester,
  };
  const verdict = evaluate(rules, use, env);
  if (verdict.decision === "deny") {
    return {
      granted: false,
      requester,
      reason: verdict.reason,
      decision: "deny",
      ruleId: verdict.ruleId,
      limited: verdict.limited,
    };
  }
  return {
    granted: true,
    requester,
    reason: verdict.reason,
    decision: verdict.decision,
    ruleId: verdict.ruleId,
    once: verdict.once,
    needsHold: verdict.needsHold,
  };
}

/** The clock and the time zone of this PC, with no history of uses. */
export function systemEnv(uses: RulesEnv["uses"] = () => 0): RulesEnv {
  return { now: () => Date.now(), local: (ms) => localTime(ms), uses };
}
