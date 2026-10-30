import { type Route, Router } from "./router.ts";

export interface Tab {
  id: string;
  router: Router;
  pinned: boolean;
}

/** What the rest of the app uses of the navigation: always the active tab's. */
export type Navigation = Pick<
  Router,
  "current" | "canBack" | "canForward" | "push" | "back" | "forward" | "subscribe"
>;

/** The most recently closed tabs `reopen` brings back. */
export const CLOSED_LIMIT = 20;

interface Closed {
  route: Route;
  index: number;
  pinned: boolean;
}

let counter = 0;
const randomId = () => `tab-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** The window's tabs: each one a route with its own history; one is active. */
export class Tabs {
  tabs: readonly Tab[] = [];
  activeId = "";
  /** Changes with every change of the tabs or of the route of the active one. */
  version = 0;
  readonly router: Navigation;
  private closed: Closed[] = [];
  private newTab = false;
  private readonly listeners = new Set<() => void>();
  private readonly unwatch = new Map<string, () => void>();

  constructor(
    initial: Route = { name: "home" },
    private readonly newId: () => string = randomId,
  ) {
    this.activeId = this.add(initial, 0, false).id;
    // The facade follows whichever tab is active, so `store.router` keeps meaning "where I am".
    const active = () => this.active.router;
    this.router = {
      get current() {
        return active().current;
      },
      get canBack() {
        return active().canBack;
      },
      get canForward() {
        return active().canForward;
      },
      push: (route) => {
        if (this.newTab) this.open(route);
        else active().push(route);
      },
      back: () => active().back(),
      forward: () => active().forward(),
      subscribe: this.subscribe,
    };
  }

  get active(): Tab {
    return this.tabs.find((tab) => tab.id === this.activeId) as Tab;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The navigation of the next moment (this event) opens a new tab instead of using the active one. */
  openNextInNewTab(): void {
    this.newTab = true;
    setTimeout(() => {
      this.newTab = false;
    }, 0);
  }

  open(route: Route, options: { background?: boolean } = {}): Tab {
    const after = this.tabs.findIndex((tab) => tab.id === this.activeId) + 1;
    const tab = this.add(route, Math.max(after, this.pinnedCount), false);
    if (!options.background) this.activeId = tab.id;
    this.emit();
    return tab;
  }

  close(id: string): void {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    const tab = this.tabs[index];
    if (!tab) return;
    this.closed.push({ route: tab.router.current, index, pinned: tab.pinned });
    if (this.closed.length > CLOSED_LIMIT) this.closed.shift();
    this.unwatch.get(id)?.();
    this.unwatch.delete(id);
    this.tabs = this.tabs.filter((other) => other.id !== id);
    if (this.tabs.length === 0) this.activeId = this.add({ name: "home" }, 0, false).id;
    else if (this.activeId === id) {
      this.activeId = (this.tabs[Math.min(index, this.tabs.length - 1)] as Tab).id;
    }
    this.emit();
  }

  /** Brings back the last closed tab, where it was, and activates it. */
  reopen(): Tab | null {
    const closed = this.closed.pop();
    if (!closed) return null;
    const index = closed.pinned
      ? Math.min(closed.index, this.pinnedCount)
      : Math.max(closed.index, this.pinnedCount);
    const tab = this.add(closed.route, Math.min(index, this.tabs.length), closed.pinned);
    this.activeId = tab.id;
    this.emit();
    return tab;
  }

  activate(id: string): void {
    if (!this.tabs.some((tab) => tab.id === id)) return;
    this.activeId = id;
    this.emit();
  }

  next(): void {
    this.step(1);
  }

  previous(): void {
    this.step(-1);
  }

  /** Ctrl+1…8 go to that tab, Ctrl+9 and any number past the end to the last. */
  goto(n: number): void {
    if (n < 1) return;
    this.activeId = (this.tabs[Math.min(n, 9, this.tabs.length) - 1] as Tab).id;
    this.emit();
  }

  pin(id: string, pinned: boolean): void {
    const tab = this.tabs.find((other) => other.id === id);
    if (!tab) return;
    tab.pinned = pinned;
    this.tabs = [...this.tabs.filter((t) => t.pinned), ...this.tabs.filter((t) => !t.pinned)];
    this.emit();
  }

  /** Reorders inside the tab's own group: a pinned tab never crosses an unpinned one. */
  move(id: string, toIndex: number): void {
    const from = this.tabs.findIndex((tab) => tab.id === id);
    const tab = this.tabs[from];
    if (!tab) return;
    const [low, high] = tab.pinned
      ? [0, this.pinnedCount - 1]
      : [this.pinnedCount, this.tabs.length - 1];
    const rest = this.tabs.filter((other) => other.id !== id);
    rest.splice(Math.min(Math.max(toIndex, low), high), 0, tab);
    this.tabs = rest;
    this.emit();
  }

  private get pinnedCount(): number {
    return this.tabs.filter((tab) => tab.pinned).length;
  }

  private step(by: number): void {
    const index = this.tabs.findIndex((tab) => tab.id === this.activeId);
    this.activeId = (this.tabs[(index + by + this.tabs.length) % this.tabs.length] as Tab).id;
    this.emit();
  }

  private add(route: Route, index: number, pinned: boolean): Tab {
    const tab: Tab = { id: this.newId(), router: new Router(route), pinned };
    this.unwatch.set(
      tab.id,
      tab.router.subscribe(() => {
        if (tab.id === this.activeId) this.emit();
      }),
    );
    this.tabs = [...this.tabs.slice(0, index), tab, ...this.tabs.slice(index)];
    return tab;
  }

  private emit(): void {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}
