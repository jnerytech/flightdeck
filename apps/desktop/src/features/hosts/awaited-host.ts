import type { Route } from "../../lib/router.ts";

/** The host a screen needs online to show anything, or null for a screen that needs none. */
export function awaitedHost(_route: Route): string | null {
  return "";
}
