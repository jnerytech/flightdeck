import type { Platform } from "../platform/types.ts";

export type Density = "compact" | "comfortable";

/** Where the choice is kept; compact (32 px rows) when absent. */
export const DENSITY_KEY = "flightdeck.density";

/** How tall the list rows are: compact (32 px) or comfortable (40 px), kept across starts. */
export class DensityController {
  value: Density;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Platform["storage"]) {
    this.value = storage.getItem(DENSITY_KEY) === "comfortable" ? "comfortable" : "compact";
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(value: Density): void {
    this.value = value;
    this.storage.setItem(DENSITY_KEY, value);
    for (const listener of this.listeners) listener();
  }
}
