import type { Route } from "@/lib/router.ts";
import { tabKind } from "../../tabs/domain/tab-badge.ts";
import type { NavKey } from "../nav-icons.ts";

/** The sidebar item a route belongs to, so the bar can mark where the user is. */
export function activeNav(route: Route): NavKey | null {
  const kind = tabKind(route);
  if (kind === "session") return "sessions";
  if (kind === "card") return route.name === "board" ? "board" : null;
  if (kind === "terminal" || kind === "reader" || kind === "agent" || kind === "screen")
    return null;
  return kind;
}
