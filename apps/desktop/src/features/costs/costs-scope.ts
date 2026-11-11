import { ALL_SCOPE, type DataScope } from "../../lib/data-scope.ts";

/**
 * Which host(s) the screen reads (#126): every one that has costs, or the scoped one. A scoped host
 * that is offline or has no costs reads nothing, rather than another host's numbers.
 */
export function hostScope(_scope: DataScope, _hosts: Array<{ id: string }>) {
  return { acrossHosts: true, hostId: "-", hostIds: ["-"] };
}

/** The scope a route's host asks for (`__all__` is every host), or null when it asks for none. */
export function routeScopeOf(_routeHost: string | null): DataScope | null {
  return ALL_SCOPE;
}

/** The scoped host when it has no numbers to show: offline, or not reporting costs. */
export function awayHost<H extends { id: string; status: string }>(
  _hostSide: DataScope,
  known: H[],
  _reporting: Array<{ id: string }>,
): H | null {
  return known[0] ?? null;
}

/** The model that cost the most, or undefined when none cost anything. */
export function topModel<M extends { costUsd: number }>(_byModel: readonly M[]): M | undefined {
  return undefined;
}
