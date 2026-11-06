import type { AccountState } from "@flightdeck/protocol";
import type { AppState } from "./app-store.ts";
import type { Route } from "./router.ts";

/** What the foot of the sidebar shows: one account, or how many there are when the hosts differ. */
export interface FootAccount {
  account: AccountState | null;
  /** More than one different account on the online hosts and no host open: how many. */
  many: number;
  /** The host whose account is shown (the account menu copies it); `null` with none or many. */
  hostId: string | null;
}

/**
 * The account of the host the person is on; with no host open, the one account the online hosts
 * share, or how many they have. Offline hosts keep a cached account that is not shown.
 */
export function footAccount(state: AppState, route: Route | undefined): FootAccount {
  const online = state.hosts.filter((host) => host.status === "online");
  const open = route && "host" in route ? online.find((host) => host.id === route.host) : undefined;
  if (open) return { account: state.account[open.id] ?? null, many: 0, hostId: open.id };
  const read = online.flatMap((host) => {
    const found = state.account[host.id];
    return found ? [{ hostId: host.id, account: found }] : [];
  });
  const named = read.filter((r) => r.account.name);
  const names = new Set(named.map((r) => r.account.name));
  if (names.size > 1) return { account: null, many: names.size, hostId: null };
  const shown = named[0] ?? read[0];
  return { account: shown?.account ?? null, many: 0, hostId: shown?.hostId ?? null };
}
