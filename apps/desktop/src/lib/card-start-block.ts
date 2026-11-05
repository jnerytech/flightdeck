import type { Card } from "@flightdeck/protocol";

/** Why a card cannot be started from the menu now, or null when it can. */
export function cardStartBlock(
  _card: Pick<Card, "queued" | "sessionStatus">,
): "queued" | "running" | null {
  return null;
}
