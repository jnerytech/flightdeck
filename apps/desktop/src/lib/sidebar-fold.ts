import type { Platform } from "../platform/types.ts";

/** Where the choice of a folded sidebar is kept; unfolded when absent. */
export const SIDEBAR_FOLD_KEY = "flightdeck.sidebarFolded";

/** Whether the person folded the wide window's sidebar to its rail (issue #641). */
export class SidebarFoldController {
  folded = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Platform["storage"]) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(_folded: boolean): void {}
}
