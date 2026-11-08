import { useMemo, useSyncExternalStore } from "react";
import type { AppStore } from "../lib/app-store.ts";
import { switcherHosts } from "../lib/tab-scope.ts";

/**
 * The hosts the top bar's switcher shows (#932), as it names them: the active tab's host (else the
 * one the window shows), or every host with "Tabs of all hosts". Redraws when either changes.
 */
export function useSwitcherHosts<T extends { id: string }>(
  store: AppStore,
  hosts: readonly T[],
): T[] {
  useSyncExternalStore(store.hostTabs.subscribe, () => store.hostTabs.version);
  const scope = useSyncExternalStore(store.tabScope.subscribe, () => store.tabScope.value);
  const hostId = store.activeHostId() ?? store.uiHostId();
  return useMemo(() => switcherHosts(hosts, scope, hostId), [hosts, scope, hostId]);
}
