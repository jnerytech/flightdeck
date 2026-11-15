import type { Route } from "@/lib/router.ts";
import type { NavKey } from "../nav-icons.ts";

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
  overview: "overview",
  "needs-you": "needs-you",
  activity: "activity",
  "pull-requests": "pull-requests",
  workflows: "workflows",
  history: "history",
  host: "host",
  plugins: "plugins",
  costs: "costs",
  conversations: "conversations",
  teams: "teams",
  personas: "personas",
  clients: "clients",
  setup: "setup",
  snippets: "snippets",
  connections: "connections",
  vault: "vault",
  settings: "settings",
};

/** The card's diff lives in the card, so a card tab is also the diff's. */
export function tabKind(route: Route): TabKind {
  return KINDS[route.name] ?? "screen";
}
