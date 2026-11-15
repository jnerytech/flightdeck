import { useEffect } from "react";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import { hasBackgroundHost, refreshSignature } from "./domain/hub-derive.ts";

/** How often the hub asks the hosts about their background sessions. */
const BG_REFRESH_MS = 10_000;

/** Keeps the hub's session lists fresh: when hosts come online or change, and while background sessions run. */
export function useHubRefresh(store: AppStore, hosts: AppState["hosts"]) {
  // Reload when hosts come online (and say what they offer) or sessions come and go. A host that
  // keeps failing to connect changes status on every attempt: only being online counts.
  const signature = refreshSignature(hosts);
  useEffect(() => {
    if (signature) void store.sessionLists.refresh();
  }, [store, signature]);

  // Background sessions change state on their own (a permission asked, a turn done): while the
  // hub is open and a host has them, it asks again every BG_REFRESH_MS.
  const withBackground = hasBackgroundHost(hosts);
  useEffect(() => {
    if (!withBackground) return;
    let stopped = false;
    let cancel: (() => void) | undefined;
    const schedule = () => {
      cancel = store.later(() => {
        void store.sessionLists.refresh().then(() => {
          if (!stopped) schedule();
        });
      }, BG_REFRESH_MS);
    };
    schedule();
    return () => {
      stopped = true;
      cancel?.();
    };
  }, [store, withBackground]);
}
