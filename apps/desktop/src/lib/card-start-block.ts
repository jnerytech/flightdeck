import type { Card } from "@flightdeck/protocol";

const LIVE = new Set(["starting", "running", "awaiting_permission"]);

/** Why a card cannot be started from the menu now, or null when it can. */
export function cardStartBlock(
  card: Pick<Card, "queued" | "sessionStatus">,
): "queued" | "running" | null {
  if (card.queued) return "queued";
  return card.sessionStatus && LIVE.has(card.sessionStatus) ? "running" : null;
}
