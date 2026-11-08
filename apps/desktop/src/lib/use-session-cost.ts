import { useEffect, useState } from "react";
import type { AppStore } from "./app-store.ts";

/**
 * The estimated cost of a session, once its Claude session is known and the host reports costs
 * (phase 8). It is asked again whenever the session's status changes, and reads null until the
 * host answers (and when it has no figure).
 */
export function useSessionCost(
  store: Pick<AppStore, "hostCommand">,
  hostId: string,
  claudeSessionId: string | null | undefined,
  withCosts: boolean,
  status: string | undefined,
): number | null {
  const [costUsd, setCostUsd] = useState<number | null>(null);
  useEffect(() => {
    setCostUsd(null);
    if (!claudeSessionId || !withCosts || !status) return;
    void store
      .hostCommand(hostId, "costs.session", { claudeSessionId })
      .then((r) => setCostUsd(r?.costUsd ?? null));
  }, [store, hostId, claudeSessionId, withCosts, status]);
  return costUsd;
}
