import { ROUTE_NAMES, type Route } from "../../../lib/router.ts";
import { NOT_KEPT, Tabs, Workspace, type WorkspaceSnapshot } from "../../tabs/index.ts";
import { routeHost } from "./route-host.ts";

/** A kept tab: its screen, and whether it was pinned or a preview. */
export interface Entry {
  route: Route;
  pinned: boolean;
  preview?: boolean;
}

/** A host's Overview: what a host with no tab shows. */
export const overview = (host: string): Route => ({ name: "host", host });

/** The usable tabs of a stored list (a known screen that is kept), and which one was active. */
function collect(tabs: unknown, active: unknown): { entries: Entry[]; active?: Entry } {
  const at = Number.isInteger(active) ? (active as number) : 0;
  const entries: Entry[] = [];
  let chosen: Entry | undefined;
  (Array.isArray(tabs) ? tabs : []).forEach((raw, i) => {
    const tab = raw as { route?: { name?: unknown }; pinned?: unknown; preview?: unknown } | null;
    const name = tab?.route?.name;
    if (typeof name !== "string" || !ROUTE_NAMES.has(name) || NOT_KEPT.has(name)) return;
    const entry = {
      route: tab?.route as Route,
      pinned: tab?.pinned === true,
      preview: tab?.preview === true,
    };
    entries.push(entry);
    if (i === at) chosen = entry;
  });
  return { entries, active: chosen ?? entries[0] };
}

/** The parts a window is made of, built by `restore` before the window listens to them. */
export interface Parts {
  shared: Tabs;
  sets: Map<string, Workspace>;
  hostId: string | null;
  onShared: boolean;
}

/**
 * The entries in strip order, pinned ones first (as `Tabs` puts them), and the index of `active`
 * among them: `Tabs.restore` activates by the strip's index.
 */
function inStrip(entries: Entry[], active: Entry | undefined): [Entry[], number] {
  const strip = [
    ...entries.filter((entry) => entry.pinned),
    ...entries.filter((entry) => !entry.pinned),
  ];
  return [strip, Math.max(0, strip.indexOf(active as Entry))];
}

/** A shared set from kept entries: every tab pinned. */
function sharedTabs(entries: Entry[], active: Entry | undefined, newId?: () => string): Tabs {
  if (entries.length === 0) return new Tabs(null, newId);
  const tabs = Tabs.restore(entries, Math.max(0, entries.indexOf(active as Entry)), newId);
  for (const tab of tabs.tabs) if (!tab.pinned) tabs.pin(tab.id, true);
  return tabs;
}

/** A kept window (v2): each host's set keeps only its own screens. */
export function fromV2(data: Record<string, unknown>, newId?: () => string): Parts {
  const stored = (data.shared ?? {}) as { tabs?: unknown; active?: unknown };
  const shared = collect(stored.tabs, stored.active);
  const own = shared.entries.filter((entry) => routeHost(entry.route) === null);
  const sets = new Map<string, Workspace>();
  const hosts = data.hosts && typeof data.hosts === "object" ? data.hosts : {};
  for (const [id, raw] of Object.entries(hosts as Record<string, unknown>)) {
    const snap = (raw ?? {}) as Partial<WorkspaceSnapshot>;
    const areas = (Array.isArray(snap.areas) ? snap.areas : [])
      .map((area) => {
        const { entries, active } = collect(area?.tabs, area?.active);
        const [tabs, at] = inStrip(
          entries.filter((entry) => routeHost(entry.route) === id),
          active,
        );
        return { tabs, active: at };
      })
      .filter((area) => area.tabs.length > 0);
    sets.set(id, Workspace.restore({ ...snap, v: 1, areas }, newId, overview(id)));
  }
  const hostId =
    typeof data.host === "string" && sets.has(data.host)
      ? data.host
      : (sets.keys().next().value ?? null);
  const sharedSet = sharedTabs(
    own,
    own.includes(shared.active as Entry) ? shared.active : own[0],
    newId,
  );
  const onShared = sharedSet.tabs.length > 0 && (hostId === null || data.onShared === true);
  return { shared: sharedSet, sets, hostId, onShared };
}

/**
 * Today's window (v1): its areas' tabs, in order, go to their host's set or to the shared set.
 * The active tab of the focused area stays active, and its host is the switcher's (on a shared
 * tab, the first host seen). A split is not kept: each host starts with one area.
 */
export function fromV1(data: Record<string, unknown>, newId?: () => string): Parts {
  const areas = (Array.isArray(data.areas) ? data.areas : []).slice(0, 2).map((area) => {
    const raw = (area ?? {}) as { tabs?: unknown; active?: unknown };
    return collect(raw.tabs, raw.active);
  });
  const focused = areas[data.focus === 1 && areas.length === 2 ? 1 : 0];
  const active = focused?.active;
  const shared: Entry[] = [];
  const byHost = new Map<string, Entry[]>();
  for (const entry of areas.flatMap((area) => area.entries)) {
    const host = routeHost(entry.route);
    if (host === null) shared.push(entry);
    else byHost.set(host, [...(byHost.get(host) ?? []), entry]);
  }
  const sets = new Map<string, Workspace>();
  for (const [id, entries] of byHost) {
    // A host whose tab was not the active one starts on its first tab in today's order.
    const [strip, at] = inStrip(entries, entries.includes(active as Entry) ? active : entries[0]);
    sets.set(
      id,
      new Workspace(overview(id), newId, {
        areas: [Tabs.restore(strip, at, newId)],
        split: null,
        focus: 0,
        fraction: 0.5,
      }),
    );
  }
  const activeHost = active ? routeHost(active.route) : null;
  const hostId = activeHost ?? byHost.keys().next().value ?? null;
  const onShared = active !== undefined && activeHost === null;
  return { shared: sharedTabs(shared, active, newId), sets, hostId, onShared };
}
