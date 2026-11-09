import type { AppStore } from "../../lib/app-store.ts";
import type { AwayView } from "../../lib/away-summary.ts";
import type { Route } from "../../lib/router.ts";

/** "While you were away": per host, what finished, reached review, merged or failed since the app closed. */
export function WhileAway(
  _props: Readonly<{ store: AppStore; view: AwayView; go(route: Route): void }>,
) {
  return null;
}
