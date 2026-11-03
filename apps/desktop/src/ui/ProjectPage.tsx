import type { AppState, AppStore } from "../lib/app-store.ts";
import type { Route } from "../lib/router.ts";

/** One project: where Board, Sessions, Workflows, Costs and its settings open from (issue #9). */
export function ProjectPage(_props: {
  store: AppStore;
  state: AppState;
  hostId: string;
  projectId: string;
  go(route: Route): void;
}) {
  return null;
}
