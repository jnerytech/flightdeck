import type { AppState, HostView } from "./app-store.ts";
import type { Route } from "./router.ts";

/** What the status bar's right side says about the whole app (issue #491). */
export interface StatusBarSummary {
  hostsOnline: number;
  hostsTotal: number;
  /** Terminal tabs open in the workspace. */
  terminals: number;
  /** The hosts' keep-awake, as one: holding now, on, or off; null when no host offers it. */
  keepAwake: "holding" | "on" | "off" | null;
  /** The host a press on the keep-awake item opens. */
  keepAwakeHostId: string | null;
  /** The app's own update: ready to install, on offer, or the last check failed; null when none. */
  update: "ready" | "available" | "failed" | null;
  updateVersion: string | null;
}

/** The summary of the app's state; `terminalTabs` is how many terminal tabs the workspace holds (stub: nothing is read yet). */
export function statusBarSummary(
  _state: Pick<AppState, "hosts" | "appUpdate" | "settings">,
  _terminalTabs: number,
): StatusBarSummary {
  return {
    hostsOnline: 0,
    hostsTotal: 0,
    terminals: 0,
    keepAwake: null,
    keepAwakeHostId: null,
    update: null,
    updateVersion: null,
  };
}

/** Where the hosts item goes: the first host that is not online, else the host in view, else the first one; the form to add one when there is none (stub: always the hub). */
export function hostsRoute(
  _hosts: Pick<HostView, "id" | "status">[],
  _currentId: string | null,
): Route {
  return { name: "hub" };
}
