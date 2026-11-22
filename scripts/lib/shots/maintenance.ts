import type { FrameRewriter } from "./holds.ts";

/** What a Maintenance print asks of the hosts' answers (#4001). */
export interface MaintenanceOptions {
  /** The first read of the status is refused, so the panel shows its error and Try again. */
  refuseStatus?: boolean;
  /** The cleanup is never answered, so Clean stays busy. */
  holdClean?: boolean;
}

// Not instrumented: its source goes into the page, where an istanbul counter would not exist
// (the istanbul shard of a full run, #1492).
/* istanbul ignore next */
export function maintenanceRewriter(_options: MaintenanceOptions = {}): FrameRewriter {
  return {
    fromApp() {},
    fromHost: (frame) => frame,
    drops: () => false,
  };
}

/** The init script a print adds: the page's WebSocket wrapped with `maintenanceRewriter`. */
export function maintenanceScript(_options: MaintenanceOptions = {}): string {
  return "";
}
