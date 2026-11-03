import type { AppState, AppStore } from "../lib/app-store.ts";
import type { ProjectCard } from "../lib/project-cards.ts";

/** Every project of every host as cards, with search and sort (issue #9). */
export function ProjectsOverview(_props: {
  store: AppStore;
  state: AppState;
  onOpen(card: ProjectCard): void;
}) {
  return null;
}
