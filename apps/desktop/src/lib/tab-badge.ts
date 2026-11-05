import type { NavKey } from "@/components/nav-icons";
import { type AppState, needsYou, sessionKey } from "./app-store.ts";
import type { Route } from "./router.ts";

/** What a tab shows besides its title: something waits for the user, a session is working, or it replied unseen. */
export type TabBadge = "needs-you" | "running" | "unread" | null;

export function tabBadge(route: Route, state: AppState): TabBadge {
  if (route.name === "needs-you") return needsYou(state).length > 0 ? "needs-you" : null;
  if (route.name !== "session") return null;
  const session = state.hosts
    .find((host) => host.id === route.host)
    ?.sessions.find((candidate) => candidate.id === route.id);
  if (!session) return null;
  if (session.pendingPermissions.length > 0) return "needs-you";
  if (session.status === "running" || session.status === "starting") return "running";
  return state.unread[sessionKey(route.host, route.id)] ? "unread" : null;
}

/** Since when the session of a tab has been idle (its prompt cache runs from then), else null. */
export function tabIdleSince(route: Route, state: AppState): string | null {
  void route;
  void state;
  return null;
}

/** Whether the badge pulses: a session that is working moves, so a glance at the tabs shows it. */
export function badgePulses(badge: TabBadge): boolean {
  return badge === "running";
}

/** The kind of screen a tab shows, for its icon. */
export type TabKind = NavKey | "session" | "card" | "terminal" | "reader" | "agent" | "screen";

const KINDS: Partial<Record<Route["name"], TabKind>> = {
  session: "session",
  external: "session",
  "new-session": "session",
  card: "card",
  board: "card",
  "all-projects": "projects",
  project: "projects",
  terminal: "terminal",
  reader: "reader",
  agent: "agent",
  hub: "sessions",
  "needs-you": "needs-you",
  workflows: "workflows",
  history: "history",
  host: "host",
  plugins: "plugins",
  costs: "costs",
  conversations: "conversations",
  teams: "teams",
  personas: "personas",
  clients: "clients",
  snippets: "snippets",
  connections: "connections",
  vault: "vault",
  settings: "settings",
};

/** The card's diff lives in the card, so a card tab is also the diff's. */
export function tabKind(route: Route): TabKind {
  return KINDS[route.name] ?? "screen";
}
