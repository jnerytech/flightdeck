import type { Platform } from "../../platform/types.ts";
import { COLUMN_WIDTH, clampWidth } from "./domain/board-select.ts";

/** Where the columns' width is kept (issue #161). */
export const COLUMN_WIDTH_KEY = "flightdeck.boardColumnWidth";

/** The columns' width, kept across starts. */
export class BoardWidth {
  value: number;
  /** True once the person has set a width, or one was kept: until then the columns share the board. */
  chosen = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Platform["storage"]) {
    let stored = Number.NaN;
    try {
      stored = Number(storage.getItem(COLUMN_WIDTH_KEY));
    } catch {
      // A storage that cannot be read (a private window): the default width.
    }
    this.chosen = Number.isFinite(stored) && stored > 0;
    this.value = this.chosen ? clampWidth(stored) : COLUMN_WIDTH.default;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Sets the width; `persist: false` while a drag is going, then `persist()` when it ends. */
  set(width: number, persist = true): void {
    this.value = clampWidth(width);
    this.chosen = true;
    if (persist) this.persist();
    for (const listener of this.listeners) listener();
  }

  /** Keeps the width across starts; a storage that refuses (quota, private window) is not fatal. */
  persist(): void {
    try {
      this.storage.setItem(COLUMN_WIDTH_KEY, String(this.value));
    } catch {
      // The width still holds for this run.
    }
  }
}
