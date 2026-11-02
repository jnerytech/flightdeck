import type { NavKey } from "@/components/nav-icons";
import type { Route } from "./router.ts";

/** The sidebar item a route belongs to, so the bar can mark where the user is. */
export function activeNav(_route: Route): NavKey | null {
  return "settings";
}
