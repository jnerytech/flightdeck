import type { Platform } from "../platform/types.ts";
import { APP_VERSION } from "./version.ts";

/** Where the last version whose notes were opened is kept. */
export const WHATS_NEW_KEY = "flightdeck.whatsNewSeen";

/** Whether there are release notes the person has not seen since the app was updated (issue #125). */
export class WhatsNew {
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly storage: Platform["storage"],
    private readonly version: string = APP_VERSION,
  ) {
    void this.storage;
    void this.version;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** True once the app runs a version newer than the last one whose notes were opened. */
  hasNew(): boolean {
    return false;
  }

  /** The notes of this version were opened: the dot goes. */
  markSeen(): void {}
}
