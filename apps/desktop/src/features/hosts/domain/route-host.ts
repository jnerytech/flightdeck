import type { Route } from "../../../lib/router.ts";

/**
 * Who owns each screen: a host (the route's `host`, its id), the reader's target host, or no host
 * (a screen shared by every host). A `host` on a cross-host screen (hub, all projects, costs,
 * teams) is a filter, sometimes the host's name, so those stay shared. The record lists every
 * route name, so a new screen cannot go unclassified.
 */
const OWNER: Record<Route["name"], "host" | "reader" | null> = {
  start: null,
  home: null,
  overview: null,
  hub: null,
  "needs-you": null,
  activity: null,
  session: "host",
  "new-session": "host",
  external: "host",
  reader: "reader",
  history: "host",
  host: "host",
  projects: "host",
  "all-projects": null,
  project: "host",
  board: "host",
  card: "host",
  workflows: "host",
  agent: "host",
  automations: "host",
  actions: "host",
  "auto-approvals": "host",
  terminal: "host",
  preview: null,
  settings: null,
  costs: null,
  connections: null,
  snippets: null,
  personas: null,
  clients: null,
  plugins: null,
  setup: null,
  conversations: null,
  "pull-requests": null,
  teams: null,
  vault: null,
  "add-host": null,
};

/** The host a screen belongs to (its id), or null for a screen shared by every host. */
export function routeHost(route: Route): string | null {
  const owner = OWNER[route.name];
  if (owner === "reader") return (route as Extract<Route, { name: "reader" }>).target.hostId;
  return owner === "host" ? (route as { host: string }).host : null;
}
