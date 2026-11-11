import type { Card } from "@flightdeck/protocol";
import type { T } from "../../i18n/index.ts";
import type { QuietAlert } from "../../lib/quiet.ts";

/** #1553: the words of a card's quiet badge (short on the card, full on hover), or null when its session is not quiet. */
export function quietBadge(
  _card: Pick<Card, "sessionId">,
  _hostId: string,
  _alerts: ReadonlyMap<string, QuietAlert>,
  _nowMs: number,
  _t: T,
): { short: string; full: string } | null {
  return { short: "", full: "" };
}
