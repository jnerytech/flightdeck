import type { AppState } from "../../../lib/app-store.ts";
import type { Route } from "../../../lib/router.ts";
import type { HubRow } from "./hub.ts";

/** The session open on the right of Sessões, if any (its daemon id or its Claude id). */
export function openedSession(
  route: Route,
  state: Pick<AppState, "selected">,
): { id?: string; claude?: string } {
  if (route.name === "session") return { id: route.id };
  if (route.name === "external") return { claude: route.claudeSessionId };
  if (route.name === "reader") return { claude: route.target.claudeSessionId };
  if (route.name === "home" && state.selected?.sessionId) return { id: state.selected.sessionId };
  return {};
}

/** The routes of Sessões: the list on the left, the open session or the new-session form on the right. */
export const SESSIONS_ROUTES: ReadonlySet<Route["name"]> = new Set([
  "hub",
  "home",
  "session",
  "external",
  "new-session",
  "reader",
]);

/** Whether the row is the session open on the right (by its daemon id or its Claude id). */
export function rowIsOpen(row: HubRow, opened: { id?: string; claude?: string }): boolean {
  return (
    (opened.id !== undefined && row.sessionId === opened.id) ||
    (opened.claude !== undefined && row.claudeSessionId === opened.claude)
  );
}
