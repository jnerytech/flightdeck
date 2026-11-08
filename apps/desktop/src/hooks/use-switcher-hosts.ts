import { useMemo, useSyncExternalStore } from "react";
import type { AppStore } from "../lib/app-store.ts";
import { switcherHosts } from "../lib/tab-scope.ts";

/**
 * The host the top bar's switcher names (#932): the active tab's host, else the one the window
 * shows. Redraws when the switcher moves.
 */
export function useSwitcherHostId(store: AppStore): string | null {
  useSyncExternalStore(store.hostTabs.subscribe, () => store.hostTabs.version);
  return store.activeHostId() ?? store.uiHostId();
}

/**
 * The hosts the top bar's switcher shows (#932): its host, or every host with "Tabs of all hosts".
 * Redraws when either changes.
 */
export function useSwitcherHosts<T extends { id: string }>(
  store: AppStore,
  hosts: readonly T[],
): T[] {
  const hostId = useSwitcherHostId(store);
  const scope = useSyncExternalStore(store.tabScope.subscribe, () => store.tabScope.value);
  return useMemo(() => switcherHosts(hosts, scope, hostId), [hosts, scope, hostId]);
}
