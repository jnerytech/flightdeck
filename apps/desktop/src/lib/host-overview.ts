import { type HubRow, hubRowOrder } from "./hub.ts";
import type { ProjectCard } from "./project-cards.ts";

/** How many sessions and projects the host page's overview shows before "See all". */
export const HOST_PREVIEW = 6;

/** The host's own sessions: the ones that need you first, then pinned and latest; archived ones stay out. */
export function hostSessionRows(rows: HubRow[], hostId: string, limit = HOST_PREVIEW): HubRow[] {
  return rows
    .filter((row) => row.hostId === hostId && !row.archived)
    .sort(hubRowOrder)
    .slice(0, limit);
}

/** The host's own projects, in the order given. */
export function hostProjectCards(
  cards: ProjectCard[],
  hostId: string,
  limit = HOST_PREVIEW,
): ProjectCard[] {
  return cards.filter((card) => card.hostId === hostId).slice(0, limit);
}
