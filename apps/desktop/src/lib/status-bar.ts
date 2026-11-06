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

/** The keep-awake of the online hosts that offer it, as one: holding now, then on, then off. */
function keepAwakeOf(hosts: HostView[]): Pick<StatusBarSummary, "keepAwake" | "keepAwakeHostId"> {
  const offering = hosts.filter(
    (h) => h.status === "online" && h.hostInfo?.keepAwake !== undefined,
  );
  const holding = offering.find((h) => h.hostInfo?.keepAwake?.held);
  if (holding) return { keepAwake: "holding", keepAwakeHostId: holding.id };
  const on = offering.find((h) => h.hostInfo?.keepAwake?.enabled);
  if (on) return { keepAwake: "on", keepAwakeHostId: on.id };
  const first = offering[0];
  return first
    ? { keepAwake: "off", keepAwakeHostId: first.id }
    : { keepAwake: null, keepAwakeHostId: null };
}

/** The app's own update: ready to install, then on offer, then a failed check. */
function updateOf(
  state: AppState["appUpdate"],
): Pick<StatusBarSummary, "update" | "updateVersion"> {
  const ready = state.ready ?? null;
  if (ready) return { update: "ready", updateVersion: ready };
  if (state.offer) return { update: "available", updateVersion: state.offer.version };
  if (state.error) return { update: "failed", updateVersion: null };
  return { update: null, updateVersion: null };
}

/** The summary of the app's state; `terminalTabs` is how many terminal tabs the workspace holds. */
export function statusBarSummary(
  state: Pick<AppState, "hosts" | "appUpdate" | "settings">,
  terminalTabs: number,
): StatusBarSummary {
  return {
    hostsOnline: state.hosts.filter((h) => h.status === "online").length,
    hostsTotal: state.hosts.length,
    terminals: terminalTabs,
    ...keepAwakeOf(state.hosts),
    ...updateOf(state.appUpdate),
  };
}

/** Where the hosts item goes: the first host that is not online, else the host in view, else the first one; the form to add one when there is none. */
export function hostsRoute(
  hosts: Pick<HostView, "id" | "status">[],
  currentId: string | null,
): Route {
  const target =
    hosts.find((h) => h.status !== "online") ?? hosts.find((h) => h.id === currentId) ?? hosts[0];
  return target ? { name: "host", host: target.id } : { name: "add-host" };
}

/** The part of the workspace the bar reads: the tabs of each area and where each one is. */
interface TabsView {
  areas: ReadonlyArray<{
    tabs: ReadonlyArray<{ id: string; router: { current: { name: string } } }>;
  }>;
}

const isTerminal = (tab: TabsView["areas"][number]["tabs"][number]) =>
  tab.router.current.name === "terminal";

/** How many terminal tabs are open, in both areas. */
export function terminalTabCount(workspace: TabsView): number {
  return workspace.areas.reduce((n, area) => n + area.tabs.filter(isTerminal).length, 0);
}

/** The first terminal tab, with the area that holds it, or null when none is open. */
export function firstTerminalTab(workspace: TabsView): { area: 0 | 1; id: string } | null {
  for (const [area, tabs] of workspace.areas.entries()) {
    const found = tabs.tabs.find(isTerminal);
    if (found) return { area: area === 1 ? 1 : 0, id: found.id };
  }
  return null;
}
