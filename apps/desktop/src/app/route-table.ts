import type { ReactNode } from "react";
import type { Route } from "../lib/router.ts";
import type { HostInfo, ScreenProps } from "./screen-states.tsx";

/** What one route shows: its screen, or `null` for a route with nothing of its own. */
type RouteBuilder<N extends Route["name"]> = (
  props: ScreenProps,
  route: Extract<Route, { name: N }>,
) => ReactNode;

/** One builder for each route name a table owns; route-screens.tsx merges the tables. */
export type RouteTable<N extends Route["name"]> = { readonly [K in N]: RouteBuilder<K> };

/** The host a route names, or undefined when it was removed while the screen was open. */
export function hostOf(props: ScreenProps, id: string): HostInfo | undefined {
  return props.state.hosts.find((h) => h.id === id);
}
