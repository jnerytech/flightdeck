/**
 * Phase 16: who asks the vault for a secret. `you` is only for uses the app itself started;
 * a request that comes from the daemon is `claude`, `automation` or `workflow`, never `you`
 * (any local process that reads the config speaks the protocol). Anything else is treated as the
 * most restricted. Until phases 17 and 19 exist, every request from the daemon is denied.
 */
export type Requester = "claude" | "automation" | "workflow" | "unknown";

const DAEMON_REQUESTERS: ReadonlySet<string> = new Set(["claude", "automation", "workflow"]);

/** The requester of a daemon request, from whatever it claimed: `you` and the unknown are `unknown`. */
export function requesterOf(raw: unknown): Requester {
  return typeof raw === "string" && DAEMON_REQUESTERS.has(raw) ? (raw as Requester) : "unknown";
}

export interface RequestDecision {
  granted: boolean;
  requester: Requester;
  reason: string;
}

/** The answer to a `vault.request` of the daemon: no, in this phase, whoever asks. */
export function decideRequest(raw: { requester?: unknown }): RequestDecision {
  return {
    granted: false,
    requester: requesterOf(raw.requester),
    reason: "nesta fase o daemon não pede segredos ao cofre: só entregam os usos que o app inicia",
  };
}
