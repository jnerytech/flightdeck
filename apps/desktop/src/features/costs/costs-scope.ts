import { ALL_HOSTS } from "./costs.ts";
import { ALL_SCOPE, type DataScope } from "./data-scope.ts";

/**
 * Which host(s) the screen reads (#126): every one that has costs, or the scoped one. A scoped host
 * that is offline or has no costs reads nothing, rather than another host's numbers.
 */
export function hostScope(scope: DataScope, hosts: Array<{ id: string }>) {
  if (scope.kind === "host") {
    const there = hosts.some((h) => h.id === scope.hostId);
    return {
      acrossHosts: false,
      hostId: there ? scope.hostId : "",
      hostIds: there ? [scope.hostId] : [],
    };
  }
  const acrossHosts = hosts.length > 1;
  if (acrossHosts) return { acrossHosts, hostId: ALL_HOSTS, hostIds: hosts.map((h) => h.id) };
  const hostId = hosts[0]?.id ?? "";
  return { acrossHosts, hostId, hostIds: hostId ? [hostId] : [] };
}

/** The scope a route's host asks for (`__all__` is every host), or null when it asks for none. */
export function routeScopeOf(routeHost: string | null): DataScope | null {
  if (routeHost === ALL_HOSTS) return ALL_SCOPE;
  return routeHost === null ? null : { kind: "host", hostId: routeHost };
}

/** The scoped host when it has no numbers to show: offline, or not reporting costs. */
export function awayHost<H extends { id: string; status: string }>(
  hostSide: DataScope,
  known: H[],
  reporting: Array<{ id: string }>,
): H | null {
  const scoped = hostSide.kind === "host" ? known.find((h) => h.id === hostSide.hostId) : null;
  if (!scoped || reporting.some((h) => h.id === scoped.id)) return null;
  return scoped.status === "connecting" ? null : scoped;
}

/** The model that cost the most, or undefined when none cost anything. */
export function topModel<M extends { costUsd: number }>(byModel: readonly M[]): M | undefined {
  return [...byModel].sort((a, b) => b.costUsd - a.costUsd)[0];
}
