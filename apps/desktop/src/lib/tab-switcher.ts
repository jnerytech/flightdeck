import type { Platform } from "../platform/types.ts";

/** The switcher while Ctrl is held: the tabs in recency order and the one that would open. */
export interface SwitcherState {
  ids: string[];
  index: number;
}

/** Where the choice of the order is kept; most recently used when absent. */
export const TAB_ORDER_KEY = "flightdeck.tabOrder";

export type TabOrder = "mru" | "sequential";

/** Opens on the previous tab (Ctrl+Tab) or on the least recent one (Ctrl+Shift+Tab); null below two tabs. */
export function openSwitcher(ids: string[], direction: 1 | -1): SwitcherState | null {
  if (ids.length < 2) return null;
  return { ids, index: direction === 1 ? 1 : ids.length - 1 };
}

/** One more Tab press: down the list, or up with Shift, around the ends. */
export function stepSwitcher(state: SwitcherState, direction: 1 | -1): SwitcherState {
  const count = state.ids.length;
  return { ...state, index: (state.index + direction + count) % count };
}

/** The tab that releasing Ctrl would activate. */
export function pickedId(state: SwitcherState): string {
  return state.ids[state.index] as string;
}

/** How Ctrl+Tab orders the tabs: most recently used, or the strip's order. Kept across starts. */
export class TabOrderController {
  value: TabOrder;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Platform["storage"]) {
    this.value = storage.getItem(TAB_ORDER_KEY) === "sequential" ? "sequential" : "mru";
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(value: TabOrder): void {
    this.value = value;
    this.storage.setItem(TAB_ORDER_KEY, value);
    for (const listener of this.listeners) listener();
  }
}
