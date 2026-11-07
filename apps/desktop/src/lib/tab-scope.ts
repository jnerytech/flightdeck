import type { Platform } from "../platform/types.ts";

/** Where the choice of the tab row's scope is kept; one host's tabs when absent. */
export const TAB_SCOPE_KEY = "flightdeck.tabScope";

/** The tab row shows the current host's tabs, or every host's, grouped by host (issue #644). */
export type TabScope = "host" | "all";

export class TabScopeController {
  value: TabScope;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Platform["storage"]) {
    this.value = storage.getItem(TAB_SCOPE_KEY) === "all" ? "all" : "host";
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(value: TabScope): void {
    this.value = value;
    this.storage.setItem(TAB_SCOPE_KEY, value);
    for (const listener of this.listeners) listener();
  }
}

/**
 * The hosts the switcher shows (#932): every host with "Tabs of all hosts" or with no host chosen,
 * else only the chosen one. What lists a host's places (projects) follows it, so picking a host and
 * opening a project never lands on another host.
 */
export function switcherHosts<T extends { id: string }>(
  hosts: readonly T[],
  scope: TabScope,
  hostId: string | null,
): T[] {
  if (scope === "all" || hostId === null) return [...hosts];
  return hosts.filter((host) => host.id === hostId);
}
