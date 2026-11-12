import type { Card } from "@flightdeck/protocol";
import type { T } from "../../i18n/index.ts";

/**
 * The conflict radar's words (#1405, host feature `conflictRadar`): the host says which other cards
 * of the project change the same files. A host that does not, or a card with no overlap, has none.
 */

/** The badge on the card: the one card it may conflict with by name, or how many cards. */
export function radarBadge(card: Card, t: T): string | null {
  const others = card.mayConflict ?? [];
  const [first] = others;
  if (!first) return null;
  return others.length === 1
    ? t("conflictRadar.badgeOne", { title: first.title })
    : t("conflictRadar.badgeMany", { n: others.length });
}

/** The line in the Merge PR confirm: merging may leave those cards with conflicts. */
export function radarMergeLine(card: Card, t: T): string | null {
  const others = card.mayConflict ?? [];
  if (others.length === 0) return null;
  return t("conflictRadar.mergeLine", { titles: others.map((other) => other.title).join(", ") });
}
