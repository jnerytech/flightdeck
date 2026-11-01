import type { WatchInfo } from "@flightdeck/protocol";
import type { AppState } from "./app-store.ts";

/** A card whose PR watch asks for the person, for "Precisa de você" (phase 22). */
export interface WatchAlert {
  hostId: string;
  cardId: string;
  /** The card's title, else its id (the card was not seen yet). */
  title: string;
  projectId: string | null;
  watch: WatchInfo;
}

export function watchAlerts(state: AppState): WatchAlert[] {
  return Object.entries(state.watches)
    .filter(([, watch]) => watch.status === "needs_you")
    .map(([key, watch]) => {
      const hostId = key.slice(0, key.length - watch.cardId.length - 1);
      const card = state.cards[key];
      return {
        hostId,
        cardId: watch.cardId,
        title: card?.title ?? watch.cardId,
        projectId: card?.projectId ?? null,
        watch,
      };
    });
}
