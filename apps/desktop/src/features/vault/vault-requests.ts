import type { CommandPayload, VaultRequestFrame } from "@flightdeck/protocol";
import { checkDelivery, type DeliveryDeps } from "./domain/vault-delivery.ts";
import type { SecretMeta } from "./vault.ts";

/** What the app decides about a request of the daemon. */
type VaultDecision = { kind: "deny"; reason: string } | { kind: "deliver" };

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

type VaultDeliverPayload = CommandPayload<"vault.deliver">;

export interface AnswerDeps extends DeliveryDeps {
  policy: VaultPolicy;
  deliver: (payload: VaultDeliverPayload) => Promise<unknown>;
  now: () => number;
}

const DELIVERY_TTL_MS = 60_000;

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
  const check = await checkDelivery(request.secretId, deps);
  if (!check.ok) return outcome(false, check.reason);
  try {
    await deps.deliver({
      secretId: request.secretId,
      value: check.value,
      purpose: request.purpose,
      expiresAt: deps.now() + DELIVERY_TTL_MS,
      requester: request.requester,
    });
  } catch (error) {
    // The daemon's message never holds the value (its own tests search for it).
    return outcome(false, `delivery failed: ${(error as Error).message}`);
  }
  return outcome(true, "");
}
