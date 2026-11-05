import type { AppState, AppStore } from "../lib/app-store.ts";
import type { HubRow } from "../lib/hub.ts";
import type { Route } from "../lib/router.ts";

/** Every session across the hosts by state. (Stub: drawn in the green step.) */
export function ActivityBoard(_props: {
  store: AppStore;
  state: AppState;
  go(route: Route): void;
  onOpen(row: HubRow, newTab: boolean): void;
  /** Test seam: the hold time of a high-risk approval. */
  holdMs?: number;
}) {
  return <div />;
}
