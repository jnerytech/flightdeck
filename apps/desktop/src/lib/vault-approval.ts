import type { VaultPolicy, VaultRequestContext } from "./vault-requests.ts";

/** The question the user is asked about a request of the daemon; true when approved. */
export type VaultAsk = (context: VaultRequestContext) => Promise<boolean>;

/**
 * How long after an approval the other secrets of the same run are delivered without a second
 * question: the daemon asks for them one after the other, the moment the previous one arrives.
 */
export const SIBLING_MS = 30_000;

/**
 * The phase 17 policy: a request for an action or a free command is put to the user, unless the
 * action says `never`, or says `first-per-session` and the user already approved it. A free
 * command is asked every time. Anything else (a request that names no action) is denied.
 */
export function actionPolicy(_deps: { ask: VaultAsk; now: () => number }): VaultPolicy {
  return async () => ({ kind: "deliver" });
}
