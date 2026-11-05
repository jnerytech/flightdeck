import type { AppState, AppStore } from "../lib/app-store.ts";
import type { Route } from "../lib/router.ts";

/** The setup checklist: what is done and what is not, from the real state, each with its action. */
export function SetupPage(props: {
  store: AppStore;
  state: AppState;
  go: (route: Route) => void;
}) {
  void props;
  return null;
}
