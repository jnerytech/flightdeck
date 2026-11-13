import { useEffect, useState } from "react";
import type { AppStore } from "../../lib/app-store.ts";

/**
 * Estimated cost of every session of a card, and of its open run's (phase 8). Asked again whenever
 * `moment` changes (the card or its run moved on); `null` while unknown or when the host keeps no costs.
 */
export function useCardCosts(
  store: AppStore,
  hostId: string,
  cardId: string,
  runId: string | null,
  enabled: boolean,
  moment: string,
) {
  const [cardCost, setCardCost] = useState<number | null>(null);
  const [runCost, setRunCost] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled || !moment) return;
    void store
      .hostCommand(hostId, "costs.card", { cardId })
      .then((r) => setCardCost(r?.costUsd ?? null));
    if (runId) {
      void store
        .hostCommand(hostId, "costs.run", { runId })
        .then((r) => setRunCost(r?.costUsd ?? null));
    }
  }, [store, hostId, cardId, runId, enabled, moment]);
  return { cardCost, runCost };
}
