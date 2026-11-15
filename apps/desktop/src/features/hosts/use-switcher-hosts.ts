import { useMemo, useSyncExternalStore } from "react";
import { switcherHosts } from "./domain/switcher-hosts.ts";

/** What the switcher's hooks read of the app store: the tabs' host, the window's host and the tab scope. */
interface SwitcherStore {
  hostTabs: { subscribe(listener: () => void): () => void; readonly version: number };
  activeHostId(): string | null;
  uiModes: { hostId(): string | null };
  tabScope: { subscribe(listener: () => void): () => void; readonly value: "host" | "all" };
}

/**
 * The host the top bar's switcher names (#932): the active tab's host, else the one the window
 * shows. Redraws when the switcher moves.
 */
export function useSwitcherHostId(store: SwitcherStore): string | null {
  useSyncExternalStore(store.hostTabs.subscribe, () => store.hostTabs.version);
  return store.activeHostId() ?? store.uiModes.hostId();
}

/**
 * The hosts the top bar's switcher shows (#932): its host, or every host with "Tabs of all hosts".
 * Redraws when either changes.
 */
export function useSwitcherHosts<T extends { id: string }>(
  store: SwitcherStore,
  hosts: readonly T[],
): T[] {
  const hostId = useSwitcherHostId(store);
  const scope = useSyncExternalStore(store.tabScope.subscribe, () => store.tabScope.value);
  return useMemo(() => switcherHosts(hosts, scope, hostId), [hosts, scope, hostId]);
}
