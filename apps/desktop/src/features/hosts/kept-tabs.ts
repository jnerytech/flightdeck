import { z } from "zod";
import { readStored } from "@/shared/lib/index.ts";
import type { Route } from "../../lib/router.ts";
import { WORKSPACE_KEY } from "../tabs/index.ts";
import { HostTabs } from "./host-tabs.ts";
import { loadHosts } from "./hosts.ts";

/** Where the window is kept: the platform's storage. */
type Keep = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/**
 * The window as the last run left it (#1589): each host's tabs and the shared ones, minus the sets of
 * hosts that are not configured any more (removed before, or gone from the list). Every change of
 * the tabs is kept again from here on.
 */
export function restoreKeptTabs(storage: Keep, startRoute?: Route): HostTabs {
  // `HostTabs.restore` checks the shape area by area, so anything that is JSON passes here.
  const tabs = HostTabs.restore(
    readStored(storage, WORKSPACE_KEY, z.unknown(), null),
    undefined,
    startRoute,
  );
  const configured = new Set(loadHosts(storage).map((host) => host.id));
  for (const id of Object.keys(tabs.snapshot().hosts)) {
    if (!configured.has(id)) tabs.removeHost(id);
  }
  tabs.subscribe(() => storage.setItem(WORKSPACE_KEY, JSON.stringify(tabs.snapshot())));
  return tabs;
}
