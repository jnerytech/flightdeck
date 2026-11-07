import type { Platform } from "../platform/types.ts";

/** Where the data scope is kept across starts (#126). */
export const DATA_SCOPE_KEY = "flightdeck.dataScope";

/**
 * Whose data the scoped screens show (#126): every host, or one. It is not the host switcher's
 * choice, which is about tabs (#644): Home (and, in later slices, Sessions, Costs and Board) read
 * this one value, set from the scope menu in their toolbar.
 */
export type DataScope = { kind: "all" } | { kind: "host"; hostId: string };

export const ALL_SCOPE: DataScope = { kind: "all" };

/** The scope as kept; anything unreadable is every host. */
export function parseScope(raw: string | null): DataScope {
  try {
    const kept = JSON.parse(raw ?? "") as { kind?: unknown; hostId?: unknown };
    if (kept.kind === "host" && typeof kept.hostId === "string" && kept.hostId !== "") {
      return { kind: "host", hostId: kept.hostId };
    }
  } catch {
    // Not JSON: every host.
  }
  return ALL_SCOPE;
}

/** The scope as it applies now: a host that is no longer there means every host. */
export function activeScope(scope: DataScope, hosts: readonly { id: string }[]): DataScope {
  if (scope.kind === "host" && !hosts.some((host) => host.id === scope.hostId)) return ALL_SCOPE;
  return scope;
}

/** The hosts the scope keeps, in their order. */
export function scopeHosts<T extends { id: string }>(hosts: readonly T[], scope: DataScope): T[] {
  return scope.kind === "all" ? [...hosts] : hosts.filter((host) => host.id === scope.hostId);
}

/** The data scope of the app, kept in storage; a storage that refuses is not fatal. */
export class DataScopeController {
  value: DataScope;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Platform["storage"]) {
    let kept: string | null = null;
    try {
      kept = storage.getItem(DATA_SCOPE_KEY);
    } catch {
      // A storage that cannot be read (a private window): every host.
    }
    this.value = parseScope(kept);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(value: DataScope): void {
    this.value = value;
    try {
      this.storage.setItem(DATA_SCOPE_KEY, JSON.stringify(value));
    } catch {
      // Kept for this run only.
    }
    for (const listener of this.listeners) listener();
  }
}
