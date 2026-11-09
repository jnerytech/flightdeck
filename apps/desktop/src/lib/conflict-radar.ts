import type { Card } from "@flightdeck/protocol";
import type { T } from "../i18n/index.ts";

/**
 * The conflict radar's words (#1405, host feature `conflictRadar`): the host says which other cards
 * of the project change the same files. A host that does not, or a card with no overlap, has none.
 */

/** The badge on the card: the one card it may conflict with by name, or how many cards. */
export function radarBadge(_card: Card, _t: T): string | null {
  return null;
}

/** The line in the Merge PR confirm: merging may leave those cards with conflicts. */
export function radarMergeLine(_card: Card, _t: T): string | null {
  return null;
}
