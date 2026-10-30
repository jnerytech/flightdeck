import { type AppState, needsYou } from "./app-store.ts";
import type { Route } from "./router.ts";

/** What a tab shows besides its title: something waits for the user, or a session is working. */
export type TabBadge = "needs-you" | "running" | null;

export function tabBadge(route: Route, state: AppState): TabBadge {
  if (route.name === "needs-you") return needsYou(state).length > 0 ? "needs-you" : null;
  if (route.name !== "session") return null;
  const session = state.hosts
    .find((host) => host.id === route.host)
    ?.sessions.find((candidate) => candidate.id === route.id);
  if (!session) return null;
  if (session.pendingPermissions.length > 0) return "needs-you";
  return session.status === "running" || session.status === "starting" ? "running" : null;
}
