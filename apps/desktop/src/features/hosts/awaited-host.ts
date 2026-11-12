import type { Route } from "../../lib/router.ts";

/** The host a route's screen loads from when it opens, if any. */
export function awaitedHost(route: Route): string | null {
  switch (route.name) {
    case "reader":
      return route.target.hostId;
    case "external":
    case "history":
    case "projects":
    case "project":
    case "board":
    case "card":
    case "workflows":
    case "agent":
    case "automations":
    case "actions":
    case "auto-approvals":
    case "terminal":
      return route.host;
    default:
      return null;
  }
}
