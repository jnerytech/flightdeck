import type { Platform } from "../platform/types.ts";

/** Where the choice of a folded sidebar is kept; unfolded when absent. */
export const SIDEBAR_FOLD_KEY = "flightdeck.sidebarFolded";

/** Whether the person folded the wide window's sidebar to its rail (issue #641). */
export class SidebarFoldController {
  folded: boolean;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Platform["storage"]) {
    this.folded = storage.getItem(SIDEBAR_FOLD_KEY) === "true";
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(folded: boolean): void {
    this.folded = folded;
    this.storage.setItem(SIDEBAR_FOLD_KEY, String(folded));
    for (const listener of this.listeners) listener();
  }
}
