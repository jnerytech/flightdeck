import type { VaultPolicy, VaultRequestContext } from "./vault-requests.ts";

/** How the user approved a request: for this use or the session, from the app or the tray. */
export interface VaultAnswer {
  scope: "once" | "session";
  via: "app" | "tray";
}

/** The question the user is asked about a request of the daemon; true (or how) when approved. */
export type VaultAsk = (context: VaultRequestContext) => Promise<boolean | VaultAnswer | null>;

/** Phase 19: tells the daemon a request its rules made ask was approved, before the delivery. */
export type VaultApprove = (context: VaultRequestContext, answer: VaultAnswer) => Promise<void>;

/**
 * How long after an approval the other secrets of the same run are delivered without a second
 * question: the daemon asks for them one after the other, the moment the previous one arrives.
 */
export const SIBLING_MS = 30_000;

const ONCE: VaultAnswer = { scope: "once", via: "app" };

interface Grant {
  delivered: Set<string>;
  until: number;
  answer: VaultAnswer;
}

/**
 * The phase 17 policy: a request for an action or a free command is put to the user, unless the
 * action says `never`, or says `first-per-session` and the user already approved it. A free
 * command is asked every time. Anything else (a request that names no action) is denied.
 *
 * Phase 19: when the daemon's rules decided, their verdict wins over the action's own approval:
 * `allow` is delivered without a question, `ask` is always put to the user, and its approval is
 * sent to the daemon (`approve`) before the secret is delivered.
 */
export function actionPolicy(deps: {
  ask: VaultAsk;
  now: () => number;
  approve?: VaultApprove;
}): VaultPolicy {
  /** `first-per-session` approvals: the app has no session id in the frame, so until it restarts. */
  const remembered = new Set<string>();
  /** The approval of a run, for the secrets the daemon asks for after the first. */
  const grants = new Map<string, Grant>();
  /** The question in flight, so the same run does not ask twice at once. */
  const asking = new Map<string, Promise<VaultAnswer | null>>();

  return async (context) => {
    const { request, hostId } = context;
    const free = request.command !== undefined;
    if (request.action === undefined && !free) {
      return { kind: "deny", reason: "the request names neither an action nor a command" };
    }
    if (request.decision === "allow") return { kind: "deliver" };
    const ruled = request.decision === "ask";
    const actionKey = `${hostId}|${request.requester}|${request.action ?? ""}`;
    const runKey = `${actionKey}|${JSON.stringify(request.params ?? {})}|${request.command ?? ""}`;
    const approved = async (answer: VaultAnswer) => {
      if (ruled) await deps.approve?.(context, answer);
      return { kind: "deliver" } as const;
    };

    const grant = grants.get(runKey);
    // A request that needs holding is never covered by another's approval: each one is held.
    if (
      grant &&
      !request.needsHold &&
      deps.now() < grant.until &&
      !grant.delivered.has(request.secretId)
    ) {
      grant.delivered.add(request.secretId);
      return approved({ ...grant.answer, scope: "once" });
    }
    if (!ruled && !free && request.approval === "never") return { kind: "deliver" };
    if (!ruled && !free && request.approval !== "always" && remembered.has(actionKey)) {
      return { kind: "deliver" };
    }

    let question = asking.get(runKey);
    if (!question) {
      question = deps
        .ask(context)
        .then((answer) => (answer === true ? ONCE : answer || null))
        .finally(() => asking.delete(runKey));
      asking.set(runKey, question);
    }
    const answer = await question;
    if (!answer) return { kind: "deny", reason: "you denied the request" };
    if (!ruled && !free && request.approval !== "always") remembered.add(actionKey);
    const delivered = grants.get(runKey)?.delivered ?? new Set<string>();
    delivered.add(request.secretId);
    grants.set(runKey, { delivered, until: deps.now() + SIBLING_MS, answer });
    return approved(answer);
  };
}
