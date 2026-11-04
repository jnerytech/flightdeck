import type { SessionRecap } from "@flightdeck/protocol";

const MAX = 160;

/**
 * The one line a folded summary shows: what was done, else what was asked, as plain text (no
 * markdown marks, no line breaks), cut with an ellipsis when it is long.
 */
export function recapPreview(recap: SessionRecap): string {
  const plain = (recap.done ?? recap.asked ?? "")
    .replace(/[*`_]{1,3}/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length <= MAX ? plain : `${plain.slice(0, MAX - 1).trimEnd()}…`;
}
