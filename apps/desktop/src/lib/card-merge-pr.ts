import type { Card } from "@flightdeck/protocol";

/**
 * Issue #1196: a card's open PR can be merged from the card unless its checks are failing (GitHub
 * would refuse, and the card says so before it asks). A merged or closed PR has nothing to merge.
 */
export function canMergeCardPr(card: Pick<Card, "prUrl" | "prState" | "checksState">): boolean {
  return Boolean(card.prUrl) && card.prState === "open" && card.checksState !== "failing";
}
