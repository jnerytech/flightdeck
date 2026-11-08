import type { SessionRecap } from "@flightdeck/protocol";

const MAX = 160;
/** How much of a recap field is read: the daemon cuts them at 480, but the protocol does not (a host may send more). */
const READ = 2000;

/**
 * The one line a folded summary shows: what was done, else what was asked, as plain text (no
 * markdown marks, no line breaks), cut with an ellipsis when it is long.
 */
export function recapPreview(recap: SessionRecap): string {
  const plain = (recap.done ?? recap.asked ?? "")
    .slice(0, READ)
    .replace(/[*`_]{1,3}/g, "")
    .replace(/^\s*[-•]\s+/gm, "") // NOSONAR: the text is cut at READ (2000) chars above, 7 ms at the worst
    .replace(/\s+/g, " ")
    .trim();
  return plain.length <= MAX ? plain : `${plain.slice(0, MAX - 1).trimEnd()}…`;
}
