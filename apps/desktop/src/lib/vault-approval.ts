import type { VaultPolicy, VaultRequestContext } from "./vault-requests.ts";

/** The question the user is asked about a request of the daemon; true when approved. */
export type VaultAsk = (context: VaultRequestContext) => Promise<boolean>;

/**
 * How long after an approval the other secrets of the same run are delivered without a second
 * question: the daemon asks for them one after the other, the moment the previous one arrives.
 */
export const SIBLING_MS = 30_000;

interface Grant {
  delivered: Set<string>;
  until: number;
}

/**
 * The phase 17 policy: a request for an action or a free command is put to the user, unless the
 * action says `never`, or says `first-per-session` and the user already approved it. A free
 * command is asked every time. Anything else (a request that names no action) is denied.
 */
export function actionPolicy(deps: { ask: VaultAsk; now: () => number }): VaultPolicy {
  /** `first-per-session` approvals: the app has no session id in the frame, so until it restarts. */
  const remembered = new Set<string>();
  /** The approval of a run, for the secrets the daemon asks for after the first. */
  const grants = new Map<string, Grant>();
  /** The question in flight, so the same run does not ask twice at once. */
  const asking = new Map<string, Promise<boolean>>();

  return async (context) => {
    const { request, hostId } = context;
    const free = request.command !== undefined;
    if (request.action === undefined && !free) {
      return { kind: "deny", reason: "the request names neither an action nor a command" };
    }
    const actionKey = `${hostId}|${request.requester}|${request.action ?? ""}`;
    const runKey = `${actionKey}|${JSON.stringify(request.params ?? {})}|${request.command ?? ""}`;

    const grant = grants.get(runKey);
    if (grant && deps.now() < grant.until && !grant.delivered.has(request.secretId)) {
      grant.delivered.add(request.secretId);
      return { kind: "deliver" };
    }
    if (!free && request.approval === "never") return { kind: "deliver" };
    if (!free && request.approval !== "always" && remembered.has(actionKey)) {
      return { kind: "deliver" };
    }

    let question = asking.get(runKey);
    if (!question) {
      question = deps.ask(context).finally(() => asking.delete(runKey));
      asking.set(runKey, question);
    }
    if (!(await question)) return { kind: "deny", reason: "you denied the request" };
    if (!free && request.approval !== "always") remembered.add(actionKey);
    const delivered = grants.get(runKey)?.delivered ?? new Set<string>();
    delivered.add(request.secretId);
    grants.set(runKey, { delivered, until: deps.now() + SIBLING_MS });
    return { kind: "deliver" };
  };
}
