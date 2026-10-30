import type { T } from "../i18n/index.ts";
import type { AppState } from "./app-store.ts";
import type { Route } from "./router.ts";

/** One step of the header path: a label and, when it can be clicked, where it goes. */
export interface Crumb {
  label: string;
  route?: Route;
}

/** Where the user is, as the header path. */
export function breadcrumb(_route: Route, _state: AppState, _t: T): Crumb[] {
  return [];
}
