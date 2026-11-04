import type { AppState, AppStore } from "../../lib/app-store.ts";
import type { HubRow, HubRowState } from "../../lib/hub.ts";
import type { ProjectCard } from "../../lib/project-cards.ts";

/** What a host page leads with: that host's sessions, then its projects, each with "See all". */
export function HostOverview(_props: {
  store: AppStore;
  state: Pick<AppState, "projects" | "cards"> & HubRowState;
  host: { id: string; name: string };
  onOpenSession(row: HubRow): void;
  onOpenProject(card: ProjectCard): void;
  onSeeAllSessions(): void;
  onSeeAllProjects(): void;
  onNewSession(): void;
}) {
  return null;
}
