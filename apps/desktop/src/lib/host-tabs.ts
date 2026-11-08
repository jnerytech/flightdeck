import { ROUTE_NAMES, type Route } from "./router.ts";
import { type Navigation, type Tab, Tabs } from "./tabs.ts";
import { NOT_KEPT, Workspace, type WorkspaceSnapshot } from "./workspace.ts";

/** A kept tab: its screen, and whether it was pinned or a preview. */
interface Entry {
  route: Route;
  pinned: boolean;
  preview?: boolean;
}

/** What is kept between starts (issue #644): the shared tabs and each host's own window. */
export interface HostTabsSnapshot {
  v: 2;
  shared: { tabs: Entry[]; active: number };
  hosts: Record<string, WorkspaceSnapshot>;
  host: string | null;
  onShared: boolean;
}

/**
 * Who owns each screen: a host (the route's `host`, its id), the reader's target host, or no host
 * (a screen shared by every host). A `host` on a cross-host screen (hub, all projects, costs,
 * teams) is a filter, sometimes the host's name, so those stay shared. The record lists every
 * route name, so a new screen cannot go unclassified.
 */
const OWNER: Record<Route["name"], "host" | "reader" | null> = {
  start: null,
  home: null,
  overview: null,
  hub: null,
  "needs-you": null,
  activity: null,
  session: "host",
  "new-session": "host",
  external: "host",
  reader: "reader",
  history: "host",
  host: "host",
  projects: "host",
  "all-projects": null,
  project: "host",
  board: "host",
  card: "host",
  workflows: "host",
  agent: "host",
  automations: "host",
  actions: "host",
  "auto-approvals": "host",
  terminal: "host",
  preview: null,
  settings: null,
  costs: null,
  connections: null,
  snippets: null,
  personas: null,
  clients: null,
  plugins: null,
  setup: null,
  conversations: null,
  teams: null,
  vault: null,
  "add-host": null,
};

/** The host a screen belongs to (its id), or null for a screen shared by every host. */
export function routeHost(route: Route): string | null {
  const owner = OWNER[route.name];
  if (owner === "reader") return (route as Extract<Route, { name: "reader" }>).target.hostId;
  return owner === "host" ? (route as { host: string }).host : null;
}

/** A host's Overview: what a host with no tab shows. */
const overview = (host: string): Route => ({ name: "host", host });

const START: Route = { name: "start" };

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
interface Parts {
  shared: Tabs;
  sets: Map<string, Workspace>;
  hostId: string | null;
  onShared: boolean;
}

/** One host's tabs in the all-hosts row: its first area, whose tabs the row shows. */
export interface HostGroup {
  hostId: string;
  tabs: Tabs;
}

/**
 * The window's tabs, one set per host plus the shared screens (issue #644). Each host keeps its
 * own `Workspace` (its tabs, their histories and its split); the shared screens are one `Tabs`,
 * all pinned, shown at the left of every set. The switcher's host is always the active tab's,
 * or the last host used while a shared tab is active. Every navigation goes through `router`:
 * a screen of the current set follows today's rules, a screen of another host switches to that
 * host and shows it in its set, and a shared screen shows in the shared set.
 */
export class HostTabs {
  readonly shared: Tabs;
  readonly router: Navigation;
  hostId: string | null;
  onShared: boolean;
  /** Changes with every change of a set, of the shared tabs or of the host. */
  version = 0;
  private readonly sets: Map<string, Workspace>;
  private readonly unwatch = new Map<string, () => void>();
  private readonly listeners = new Set<() => void>();
  private readonly switchListeners = new Set<(from: string | null, to: string) => void>();
  /** Where the last switch by a navigation came from, for Back (#932); a pick forgets it. */
  private cameFrom: { hostId: string | null; onShared: boolean } | null = null;

  private constructor(
    private readonly newId: (() => string) | undefined,
    parts: Parts,
  ) {
    this.shared = parts.shared;
    this.sets = parts.sets;
    this.hostId = parts.hostId;
    this.onShared = parts.onShared;
    this.shared.subscribe(() => {
      // The last shared tab closed: the host's active tab is shown again (or the start).
      if (this.onShared && this.shared.tabs.length === 0) this.onShared = false;
      this.emit();
    });
    for (const [id, set] of this.sets) this.watch(id, set);
    const active = () => (this.onShared ? this.shared.router : (this.workspace?.router ?? null));
    const crossed = () => this.cameFrom !== null;
    this.router = {
      get current() {
        return active()?.current ?? START;
      },
      // Past the active tab's own history, Back returns across a switch (#932).
      get canBack() {
        return (active()?.canBack ?? false) || crossed();
      },
      get canForward() {
        return active()?.canForward ?? false;
      },
      push: (route) => this.go(route),
      back: () => {
        const router = active();
        if (router?.canBack) router.back();
        else this.returnFrom();
      },
      forward: () => active()?.forward(),
      subscribe: this.subscribe,
    };
  }

  /**
   * The window as it comes back after a restart: a kept window (v2), today's single list of tabs
   * (v1) split into sets by each tab's host, or a fresh window on `fallback`.
   */
  static restore(
    stored: unknown,
    newId?: () => string,
    fallback: Route = { name: "home" },
  ): HostTabs {
    const data = (stored ?? {}) as Record<string, unknown>;
    let parts: Parts | null = null;
    if (data.v === 2) parts = fromV2(data, newId);
    else if (data.v === 1) parts = fromV1(data, newId);
    if (parts && (parts.shared.tabs.length > 0 || parts.sets.size > 0)) {
      return new HostTabs(newId, parts);
    }
    const tabs = new HostTabs(newId, {
      shared: new Tabs(null, newId),
      sets: new Map(),
      hostId: null,
      onShared: false,
    });
    tabs.open(fallback);
    return tabs;
  }

  /** The current host's set, or null with no host. */
  get workspace(): Workspace | null {
    return this.hostId === null ? null : (this.sets.get(this.hostId) ?? null);
  }

  /** The active tab's id: a shared one, or the current host's focused one. */
  get activeId(): string {
    return this.onShared ? this.shared.activeId : (this.workspace?.tabs.activeId ?? "");
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * A navigation took the window to another host's tabs (#932): `from` is the host it left (null
   * from no host). The window says so, and Back returns there.
   */
  onSwitch(listener: (from: string | null, to: string) => void): void {
    this.switchListeners.add(listener);
  }

  /**
   * The way back of the switch that left `from` (the toast's button, #932): only while that
   * switch is still the last one, so a later pick or switch is not undone.
   */
  returnAcross(from: string | null): void {
    if (this.cameFrom && this.cameFrom.hostId === from) this.returnFrom();
  }

  /** Back past a switch: the host and the kind of tab the window was on (#932). */
  private returnFrom(): void {
    const left = this.cameFrom;
    if (!left) return;
    this.cameFrom = null;
    this.hostId = left.hostId;
    this.onShared = left.onShared;
    this.emit();
  }

  /** The switcher picked a host: its set, at its last active tab (its Overview when it is new). */
  switchHost(id: string): void {
    // A pick in the switcher is where the person wants to be: no way back across it.
    this.cameFrom = null;
    this.ensure(id, overview(id));
    this.hostId = id;
    this.onShared = false;
    this.emit();
  }

  /** A host was removed: its set goes, and the switcher moves to another host, or to none. */
  removeHost(id: string): void {
    if (this.cameFrom?.hostId === id) this.cameFrom = null;
    this.unwatch.get(id)?.();
    this.unwatch.delete(id);
    this.sets.delete(id);
    if (this.hostId === id) {
      this.hostId = this.sets.keys().next().value ?? null;
      this.onShared = this.hostId === null && this.shared.tabs.length > 0;
    }
    this.emit();
  }

  /** Every host's first-area tabs, host by host, for the row that shows all hosts (issue #644). */
  groups(): HostGroup[] {
    return [...this.sets]
      .map(([hostId, set]) => ({ hostId, tabs: set.areas[0] as Tabs }))
      .filter((group) => group.tabs.tabs.length > 0);
  }

  /** How many tabs a host's set holds (for "wsl - A: 5 tabs"). */
  tabCount(id: string): number {
    return (this.sets.get(id)?.areas ?? []).reduce((sum, area) => sum + area.tabs.length, 0);
  }

  /** A new tab, in its own host's set (switching to it unless in the background) or the shared one. */
  open(route: Route, options: { background?: boolean } = {}): void {
    const host = routeHost(route);
    if (host === null) {
      const tab = this.shared.open(route, options);
      this.shared.pin(tab.id, true);
      if (!options.background) this.onShared = true;
      // A first shared tab opened behind another one still needs to be the shared set's active.
      else if (this.shared.activeId === "") this.shared.activate(tab.id);
      this.emit();
    } else if (options.background) {
      const set = this.sets.get(host);
      if (set) set.tabs.open(route, options);
      else {
        const made = this.ensure(host, route);
        made.tabs.commit(made.tabs.activeId);
      }
      this.emit();
    } else this.into(host, route, (set) => set.tabs.open(route), true);
  }

  /** A screen that may already have a tab: that tab, or a new one, in the set it belongs to. */
  show(route: Route): void {
    const host = routeHost(route);
    if (host === null) this.showShared(route);
    else this.into(host, route, (set) => set.tabs.show(route), true);
  }

  /** A single click in the sidebar: the preview tab of the screen's own set (shared ones are pinned). */
  openPreview(route: Route): void {
    const host = routeHost(route);
    if (host === null) this.showShared(route);
    else this.into(host, route, (set) => set.tabs.openPreview(route), false);
  }

  /** The navigation of this event opens a new tab, whichever set it lands in. */
  openNextInNewTab(): void {
    this.shared.openNextInNewTab();
    for (const set of this.sets.values()) for (const area of set.areas) area.openNextInNewTab();
  }

  activate(tabId: string): void {
    // A tab the person picks is where they want to be: no way back across it (#932).
    if (tabId !== this.activeId) this.cameFrom = null;
    if (this.shared.tabs.some((tab) => tab.id === tabId)) {
      this.shared.activate(tabId);
      this.onShared = true;
      this.emit();
      return;
    }
    // The current host's set first; a tab of another host (the all-hosts row) switches to that host.
    const owner = [[this.hostId, this.workspace] as const, ...this.sets].find(([, set]) =>
      set?.areas.some((tabs) => tabs.tabs.some((tab) => tab.id === tabId)),
    );
    const set = owner?.[1];
    if (!owner || !set) return;
    const area = set.areas.findIndex((tabs) => tabs.tabs.some((tab) => tab.id === tabId));
    (set.areas[area] as Tabs).activate(tabId);
    set.focusArea(area as 0 | 1);
    this.hostId = owner[0];
    this.onShared = false;
    this.emit();
  }

  close(tabId: string): void {
    if (this.shared.tabs.some((tab) => tab.id === tabId)) {
      this.shared.close(tabId);
      return;
    }
    for (const set of this.sets.values()) {
      for (const area of set.areas)
        if (area.tabs.some((tab) => tab.id === tabId)) area.close(tabId);
    }
  }

  /** Ctrl+Tab: the next tab of the row, the shared ones included. */
  next(): void {
    this.step(1);
  }

  previous(): void {
    this.step(-1);
  }

  /** Ctrl+1…8 go to that tab of the row, Ctrl+9 and any number past the end to the last. */
  goto(n: number): void {
    const row = this.row();
    if (n < 1 || row.length === 0) return;
    this.activate((row[Math.min(n, 9, row.length) - 1] as Tab).id);
  }

  /** What `restore` takes back: the shared screens and each host's window (never the host form). */
  snapshot(): HostTabsSnapshot {
    const kept = this.shared.tabs.filter((tab) => !NOT_KEPT.has(tab.router.current.name));
    return {
      v: 2,
      shared: {
        tabs: kept.map((tab) => ({ route: tab.router.current, pinned: true })),
        active: Math.max(
          0,
          kept.findIndex((tab) => tab.id === this.shared.activeId),
        ),
      },
      hosts: Object.fromEntries([...this.sets].map(([id, set]) => [id, set.snapshot()])),
      host: this.hostId,
      onShared: this.onShared,
    };
  }

  /** The row: the shared tabs, then the current host's focused area. */
  private row(): Tab[] {
    return [...this.shared.tabs, ...(this.workspace?.tabs.tabs ?? [])];
  }

  private step(by: number): void {
    const row = this.row();
    if (row.length === 0) return;
    const index = row.findIndex((tab) => tab.id === this.activeId);
    this.activate((row[(index + by + row.length) % row.length] as Tab).id);
  }

  /** A navigation: the current set keeps today's rules; another set takes the screen. */
  private go(route: Route): void {
    const host = routeHost(route);
    if (host === null) {
      // A shared screen leaves the host behind: Back from it does not cross the earlier switch.
      this.cameFrom = null;
      if (this.onShared) this.shared.router.push(route);
      else this.showShared(route);
      this.onShared = true;
      this.emit();
    } else if (host === this.hostId && !this.onShared && this.workspace) {
      this.workspace.router.push(route);
    } else {
      const from = this.hostId;
      if (host !== from) this.cameFrom = { hostId: from, onShared: this.onShared };
      this.into(host, route, (set) => set.tabs.show(route), true);
      if (host !== from) for (const listener of this.switchListeners) listener(from, host);
    }
  }

  /** Shows a shared screen in the shared set, pinned, and makes it the active tab. */
  private showShared(route: Route): void {
    this.shared.show(route);
    this.shared.pin(this.shared.activeId, true);
    this.onShared = true;
    this.emit();
  }

  /**
   * Switches to `host` and runs `act` on its set; a host with no set yet gets one that starts on
   * `route` (kept as a regular tab unless `commit` is false: a sidebar preview).
   */
  private into(host: string, route: Route, act: (set: Workspace) => void, commit: boolean): void {
    const existing = this.sets.get(host);
    if (existing) act(existing);
    else {
      const set = this.ensure(host, route);
      if (commit) set.tabs.commit(set.tabs.activeId);
    }
    this.hostId = host;
    this.onShared = false;
    this.emit();
  }

  /** The host's set, made on `initial` when it has none. */
  private ensure(id: string, initial: Route): Workspace {
    const existing = this.sets.get(id);
    if (existing) return existing;
    const set = new Workspace(initial, this.newId);
    this.sets.set(id, set);
    this.watch(id, set);
    return set;
  }

  /** Follows a host's set: when its last tab closes, it shows the host's Overview. */
  private watch(id: string, set: Workspace): void {
    this.unwatch.set(
      id,
      set.subscribe(() => {
        if (set.areas.every((area) => area.tabs.length === 0)) set.tabs.open(overview(id));
        this.emit();
      }),
    );
  }

  private emit(): void {
    this.version++;
    for (const listener of this.listeners) listener();
  }
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
function fromV2(data: Record<string, unknown>, newId?: () => string): Parts {
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
function fromV1(data: Record<string, unknown>, newId?: () => string): Parts {
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
