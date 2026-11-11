import type { Card } from "@flightdeck/protocol";
import { formatDuration } from "../../i18n/format.ts";
import type { T } from "../../i18n/index.ts";
import { sessionKey } from "../../lib/app-store.ts";
import { type QuietAlert, quietText } from "../../lib/quiet.ts";

/** #1553: the words of a card's quiet badge (short on the card, full on hover), or null when its session is not quiet. */
export function quietBadge(
  card: Pick<Card, "sessionId">,
  hostId: string,
  alerts: ReadonlyMap<string, QuietAlert>,
  nowMs: number,
  t: T,
): { short: string; full: string } | null {
  const alert = card.sessionId ? alerts.get(sessionKey(hostId, card.sessionId)) : undefined;
  if (!alert) return null;
  const span = formatDuration(Math.max(0, nowMs - Date.parse(alert.since)), t);
  return { short: t("activityBoard.quiet", { span }), full: quietText(alert, nowMs, t) };
}
