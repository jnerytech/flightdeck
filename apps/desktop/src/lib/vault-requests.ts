import type { CommandPayload, VaultRequestFrame } from "@flightdeck/protocol";
import type { SecretMeta, Vault } from "./vault.ts";

/** What the app decides about a request of the daemon. */
export type VaultDecision = { kind: "deny"; reason: string } | { kind: "deliver" };

export interface VaultRequestContext {
  request: VaultRequestFrame;
  hostId: string;
  /** The vault's entry for the secret asked for; null when there is none. */
  secret: SecretMeta | null;
}

/** The seam: phase 16 denies every request, phase 17 asks the user and then delivers. */
export type VaultPolicy = (context: VaultRequestContext) => VaultDecision | Promise<VaultDecision>;

export const denyAllPolicy: VaultPolicy = () => ({
  kind: "deny",
  reason:
    "in this phase the daemon cannot ask the vault for secrets: only the uses the app starts are delivered",
});

const DAEMON_REQUESTERS: ReadonlySet<string> = new Set(["claude", "automation", "workflow"]);

export interface VaultOutcome {
  hostId: string;
  secretId: string;
  purpose: string;
  requester: string;
  delivered: boolean;
  /** Why it was not delivered; never holds a value. */
  reason: string;
}

export type VaultDeliverPayload = CommandPayload<"vault.deliver">;

export interface AnswerDeps {
  hostId: string;
  hostUrl: string;
  vault: Pick<Vault, "list" | "value">;
  policy: VaultPolicy;
  deliver: (payload: VaultDeliverPayload) => Promise<unknown>;
  now: () => number;
}

/** True when the connection to the host is loopback or Tailscale, which are encrypted or local. */
export function transportAllowed(_url: string): boolean {
  return true;
}

/**
 * Answers a `vault.request` frame. A requester outside claude, automation and workflow (`you`
 * included: any local process can speak the protocol) is unknown and denied before the policy is
 * asked.
 */
export async function answerVaultRequest(
  request: VaultRequestFrame,
  deps: AnswerDeps,
): Promise<VaultOutcome> {
  const known = DAEMON_REQUESTERS.has(request.requester);
  const outcome = (delivered: boolean, reason: string): VaultOutcome => ({
    hostId: deps.hostId,
    secretId: request.secretId,
    purpose: request.purpose,
    requester: known ? request.requester : "unknown",
    delivered,
    reason,
  });
  if (!known) return outcome(false, "unknown requester: a request of the daemon cannot be you");
  const secret = deps.vault.list().find((s) => s.id === request.secretId) ?? null;
  const decision = await deps.policy({ request, hostId: deps.hostId, secret });
  if (decision.kind === "deny") return outcome(false, decision.reason);
  return outcome(true, "");
}
