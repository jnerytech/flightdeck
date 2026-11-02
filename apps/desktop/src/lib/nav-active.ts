import type { NavKey } from "@/components/nav-icons";
import type { Route } from "./router.ts";
import { tabKind } from "./tab-badge.ts";

/** The sidebar item a route belongs to, so the bar can mark where the user is. */
export function activeNav(route: Route): NavKey | null {
  const kind = tabKind(route);
  if (kind === "session") return "sessions";
  if (kind === "card") return route.name === "board" ? "board" : null;
  if (kind === "terminal" || kind === "reader" || kind === "agent" || kind === "screen")
    return null;
  return kind;
}
