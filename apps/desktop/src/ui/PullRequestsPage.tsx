import type { AppStore } from "../lib/app-store.ts";
import type { Route } from "../lib/router.ts";

/** Every card with an open PR across the connected hosts, with what can be done to it from here. */
export function PullRequestsPage(_props: Readonly<{ store: AppStore; go(route: Route): void }>) {
  return null;
}
