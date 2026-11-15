import type {
  VaultDaemonRequester,
  VaultOutcome,
  VaultRequester,
  VaultRequestFrame,
} from "@flightdeck/protocol";
import { FlightdeckError } from "../../kernel/index.ts";
import type { Decisions, Purpose, RequestDecision } from "../../vault/index.ts";

/** What goes into the `vault.request` frames of one run, besides the secret. */
export interface Ask {
  requester: VaultRequester;
  /** Before the request id, in the purpose the secret is delivered for. */
  purposeBase: string;
  frame: Partial<VaultRequestFrame>;
  /** What the rules of phase 19 look at. */
  use: {
    purpose: Purpose;
    action?: string;
    tags: string[];
    actionApproval?: "always" | "never" | "first-per-session";
    /** The command line, for the risk classifier. */
    command: string;
    cwd: string;
    project?: string;
    session?: string;
  };
}

/** A request waiting for the app. */
export interface Waiting {
  controller: AbortController;
  denied: boolean;
  expired: boolean;
  /** Phase 19: what the rules decided; absent when the daemon runs without rules. */
  decision?: "allow" | "ask";
  needsHold: boolean;
  /** The approval may be given for the whole session. */
  once: boolean;
  purpose: string;
  approved?: { by: "app" | "tray"; scope: "once" | "session" };
}

/**
 * "Approve and don't ask again in this session": the key an approval is remembered under, and,
 * when the same session already holds it, the verdict let through without asking.
 */
export function withSessionApproval(
  verdict: RequestDecision,
  secretId: string,
  session: string | undefined,
  approved: ReadonlySet<string>,
): { verdict: RequestDecision; rememberedKey: string | null; remembered: boolean } {
  const key =
    verdict.granted && verdict.decision === "ask" && verdict.once && session
      ? [secretId, verdict.ruleId ?? "", session].join("\u0000")
      : null;
  if (verdict.granted && key && approved.has(key)) {
    return {
      verdict: {
        ...verdict,
        decision: "allow",
        once: false,
        reason: `${verdict.reason}; already approved in this session`,
      },
      rememberedKey: key,
      remembered: true,
    };
  }
  return { verdict, rememberedKey: key, remembered: false };
}

/** The audit row of one request: granted ones start pending, refused ones are closed. */
export function auditRowOf(input: {
  requestId: string;
  atMs: number;
  secretId: string;
  ask: Ask & { requester: VaultDaemonRequester };
  host: string;
  /** The window of the rule that decided, if it has one. */
  window: unknown;
  verdict: RequestDecision;
}): Parameters<Decisions["insert"]>[0] {
  const { ask, verdict } = input;
  return {
    id: input.requestId,
    atMs: input.atMs,
    secretId: input.secretId,
    requester: ask.requester,
    purpose: ask.use.purpose,
    action: ask.use.action ?? null,
    host: input.host,
    project: ask.use.project ?? null,
    session: ask.use.session ?? null,
    ruleId: verdict.ruleId,
    decision: verdict.decision,
    outcome: verdict.granted ? "pending" : "refused",
    approver: null,
    window: input.window ? JSON.stringify(input.window) : null,
    reason: verdict.reason,
  };
}

/** The `vault.request` frame the app is asked with; the rules' verdict, when there is one, rides along. */
export function requestFrameOf(input: {
  ask: Ask & { requester: VaultDaemonRequester };
  requestId: string;
  secretId: string;
  purpose: string;
  verdict: RequestDecision | undefined;
  tags: string[];
  expiresAt: number;
}): VaultRequestFrame {
  const { verdict } = input;
  return {
    ...input.ask.frame,
    type: "vault.request",
    requestId: input.requestId,
    secretId: input.secretId,
    purpose: input.purpose,
    requester: input.ask.requester,
    ...(verdict?.granted
      ? {
          decision: verdict.decision,
          ruleId: verdict.ruleId,
          reason: verdict.reason,
          once: verdict.once,
          needsHold: verdict.needsHold,
          tags: input.tags,
          expiresAt: input.expiresAt,
        }
      : {}),
  };
}

/** How a wait the app answered with no, or never answered, ends: the audit outcome and the refusal. */
export function waitRefusal(
  waiting: Waiting,
  secretId: string,
): { outcome: VaultOutcome; error: FlightdeckError } | null {
  if (waiting.denied) {
    return {
      outcome: "denied",
      error: new FlightdeckError(
        "invalid_state",
        `the app refused secret ${secretId}`,
        "action_secret_refused",
        { secret: secretId },
      ),
    };
  }
  if (waiting.expired) {
    return {
      outcome: "expired",
      error: new FlightdeckError(
        "invalid_state",
        `the request for secret ${secretId} expired unanswered and was denied`,
        "action_secret_expired",
        { secret: secretId },
      ),
    };
  }
  return null;
}

/** Who approved a delivered secret: a rule, the session's earlier approval, or the app or tray. */
export function approverOf(
  decision: "allow" | "ask",
  approvedBy: "app" | "tray" | undefined,
  remembered: boolean,
): "app" | "rule" | "session" | "tray" | null {
  if (remembered) return "session";
  if (decision === "allow") return "rule";
  return approvedBy ?? null;
}
