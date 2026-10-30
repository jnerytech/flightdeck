import type { Route } from "./router.ts";
import { type Navigation, type Tab, Tabs } from "./tabs.ts";

export type Orientation = "vertical" | "horizontal";

/** The divider's position, as the share of the window the first area takes. */
export const FRACTION_MIN = 0.2;
export const FRACTION_MAX = 0.8;

/** The window: one area of tabs, or two with a divider; the focused one takes the navigation. */
export class Workspace {
  areas: readonly Tabs[] = [];
  split: Orientation | null = null;
  focus: 0 | 1 = 0;
  fraction = 0.5;
  /** Changes with every change of the layout, of the tabs or of the route of an active tab. */
  version = 0;
  readonly router: Navigation;
  private readonly listeners = new Set<() => void>();
  private readonly unwatch = new Map<Tabs, () => void>();

  constructor(
    initial: Route = { name: "home" },
    private readonly newId?: () => string,
  ) {
    this.attach(new Tabs(initial, newId));
    const focused = () => this.tabs.router;
    this.router = {
      get current() {
        return focused().current;
      },
      get canBack() {
        return focused().canBack;
      },
      get canForward() {
        return focused().canForward;
      },
      push: (route) => focused().push(route),
      back: () => focused().back(),
      forward: () => focused().forward(),
      subscribe: this.subscribe,
    };
  }

  /** The focused area's tabs. */
  get tabs(): Tabs {
    return this.areas[this.focus] as Tabs;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Ctrl+\: splits (the new area shows the same screen) or, when split, joins the areas. */
  toggleSplit(orientation: Orientation = "vertical"): void {
    if (this.split) {
      this.join();
      return;
    }
    this.attach(new Tabs(this.tabs.router.current, this.newId));
    this.split = orientation;
    this.focus = 1;
    this.emit();
  }

  setOrientation(orientation: Orientation): void {
    if (!this.split) return;
    this.split = orientation;
    this.emit();
  }

  focusArea(area: 0 | 1): void {
    if (area >= this.areas.length || area === this.focus) return;
    this.focus = area;
    this.emit();
  }

  setFraction(fraction: number): void {
    this.fraction = Math.min(FRACTION_MAX, Math.max(FRACTION_MIN, fraction));
    this.emit();
  }

  /** Moves a tab to the other area (splitting first when there is one) and focuses it there. */
  moveToOtherArea(tabId: string): Tab | null {
    const from = this.areas.findIndex((area) => area.tabs.some((tab) => tab.id === tabId));
    const source = this.areas[from];
    if (!source) return null;
    const tab = source.take(tabId) as Tab;
    let target = this.areas[1 - from];
    if (!target) {
      target = new Tabs(undefined, this.newId);
      target.take(target.activeId);
      this.attach(target);
      this.split = "vertical";
    }
    target.adopt(tab);
    if (source.tabs.length === 0) this.detach(source);
    this.focus = this.areas.indexOf(target) as 0 | 1;
    if (this.areas.length === 1) this.split = null;
    this.emit();
    return tab;
  }

  private join(): void {
    const [first, second] = this.areas as [Tabs, Tabs];
    for (const tab of [...second.tabs]) {
      second.take(tab.id);
      first.adopt(tab, first.tabs.length);
    }
    this.detach(second);
    this.split = null;
    this.focus = 0;
    this.emit();
  }

  private attach(area: Tabs): void {
    this.areas = [...this.areas, area];
    this.unwatch.set(
      area,
      area.subscribe(() => this.emit()),
    );
  }

  private detach(area: Tabs): void {
    this.unwatch.get(area)?.();
    this.unwatch.delete(area);
    this.areas = this.areas.filter((other) => other !== area);
  }

  private emit(): void {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}
