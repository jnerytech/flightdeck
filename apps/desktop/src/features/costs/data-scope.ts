import { z } from "zod";
import { parseJsonText } from "@/shared/lib/index.ts";
import type { Platform } from "../../platform/types.ts";
import type { ConnectionStatus } from "../hosts/index.ts";

/** Where the data scope is kept across starts (#126). */
export const DATA_SCOPE_KEY = "flightdeck.dataScope";

/**
 * Whose data the scoped screens show (#126): every host, one host, or one project. It is not the host switcher's
 * choice, which is about tabs (#644): Home (and, in later slices, Sessions, Costs and Board) read
 * this one value, set from the scope menu in their toolbar.
 */
export type DataScope =
  | { kind: "all" }
  | { kind: "host"; hostId: string }
  /** One project (slice 4): a remote key spans the hosts, a folder key pins its host. */
  | { kind: "project"; projectKey: string };

export const ALL_SCOPE: DataScope = { kind: "all" };

/** The scope as kept: a host or a project with a name; anything else is every host. */
const Kept = z.union([
  z.object({ kind: z.literal("host"), hostId: z.string().min(1) }),
  z.object({ kind: z.literal("project"), projectKey: z.string().min(1) }),
]);

/** The scope as kept; anything unreadable is every host. */
export function parseScope(raw: string | null): DataScope {
  return raw === null ? ALL_SCOPE : parseJsonText<DataScope>(raw, Kept, ALL_SCOPE);
}

/**
 * The scope as it applies now: a host that is no longer there means every host. Until the host
 * list is read (`loaded`), a kept host is not gone yet, only not listed.
 */
export function activeScope(
  scope: DataScope,
  hosts: readonly { id: string }[],
  loaded = true,
): DataScope {
  if (scope.kind === "host" && loaded && !hosts.some((host) => host.id === scope.hostId)) {
    return ALL_SCOPE;
  }
  return scope;
}

/** A host's menu value starts with this; every host's has none, so no host id can take it. */
const HOST_VALUE = "host:";
/** A project's: read first, since a folder key itself starts with `host:` (slice 4). */
const PROJECT_VALUE = "project:";

/** The scope as a menu value. */
export function scopeValue(scope: DataScope): string {
  if (scope.kind === "project") return `${PROJECT_VALUE}${scope.projectKey}`;
  return scope.kind === "host" ? `${HOST_VALUE}${scope.hostId}` : "all";
}

/** The scope a menu value names; anything else is every host. */
export function scopeOfValue(value: string): DataScope {
  if (value.startsWith(PROJECT_VALUE)) {
    return { kind: "project", projectKey: value.slice(PROJECT_VALUE.length) };
  }
  return value.startsWith(HOST_VALUE)
    ? { kind: "host", hostId: value.slice(HOST_VALUE.length) }
    : ALL_SCOPE;
}

/** The hosts the scope keeps, in their order. */
export function scopeHosts<T extends { id: string }>(hosts: readonly T[], scope: DataScope): T[] {
  // A project keeps every host; each screen then keeps the project's rows.
  if (scope.kind !== "host") return [...hosts];
  return hosts.filter((host) => host.id === scope.hostId);
}

/** The scope the hub's own host filter (a host's name, before #126) stands for. */
export function hubHostScope(
  name: string,
  hosts: readonly { id: string; name: string }[],
): DataScope {
  const host = name === "" ? undefined : hosts.find((each) => each.name === name);
  return host ? { kind: "host", hostId: host.id } : ALL_SCOPE;
}

/** The data scope of the app, kept in storage; a storage that refuses is not fatal. */
export class DataScopeController {
  value: DataScope;
  private picked: boolean;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Platform["storage"]) {
    let kept: string | null = null;
    try {
      kept = storage.getItem(DATA_SCOPE_KEY);
    } catch {
      // A storage that cannot be read (a private window): every host.
    }
    this.value = parseScope(kept);
    this.picked = kept !== null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Whether a scope was ever chosen (kept in storage), not only the default. */
  get chosen(): boolean {
    return this.picked;
  }

  set(value: DataScope): void {
    this.value = value;
    this.picked = true;
    try {
      this.storage.setItem(DATA_SCOPE_KEY, JSON.stringify(value));
    } catch {
      // Kept for this run only.
    }
    for (const listener of this.listeners) listener();
  }
}

/**
 * Why a scoped host has nothing to show (#886): an incompatible daemon needs an update, any other
 * host is offline. Sessions lists sessions, the other screens numbers.
 */
export function awayKey(
  status: ConnectionStatus,
  listing: "numbers" | "sessions",
): "scope.offline" | "scope.offlineSessions" | "scope.incompatible" {
  if (status === "incompatible") return "scope.incompatible";
  return listing === "sessions" ? "scope.offlineSessions" : "scope.offline";
}
