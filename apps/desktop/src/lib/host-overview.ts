import type { HubRow } from "./hub.ts";
import type { ProjectCard } from "./project-cards.ts";

/** How many sessions and projects the host page's overview shows before "See all". */
export const HOST_PREVIEW = 6;

/** The host's own sessions: the ones that need you first, then pinned and latest; archived ones stay out. */
export function hostSessionRows(_rows: HubRow[], _hostId: string, _limit = HOST_PREVIEW): HubRow[] {
  return [];
}

/** The host's own projects, in the order given. */
export function hostProjectCards(
  _cards: ProjectCard[],
  _hostId: string,
  _limit = HOST_PREVIEW,
): ProjectCard[] {
  return [];
}
