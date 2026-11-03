import type { T } from "../i18n/index.ts";
import type { AppState, AppStore } from "../lib/app-store.ts";
import type { Route } from "../lib/router.ts";

/** The bell in the top bar: unread count and the notification center (stub). */
export function NotificationBell(_props: {
  store: AppStore;
  state: AppState;
  t: T;
  go(route: Route): void;
}) {
  return null;
}
