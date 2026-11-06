import type { Platform } from "../platform/types.ts";
import { APP_VERSION, isNewer } from "./version.ts";

/** Where the last version whose notes were opened is kept. */
export const WHATS_NEW_KEY = "flightdeck.whatsNewSeen";

/**
 * Whether there are release notes the person has not seen since the app was updated (issue #125).
 * A first run has none to see: it remembers the version it started on. A release candidate counts as
 * the version it leads up to.
 */
export class WhatsNew {
  private readonly listeners = new Set<() => void>();
  private readonly version: string;
  private seen: string;

  constructor(
    private readonly storage: Platform["storage"],
    version: string = APP_VERSION,
  ) {
    this.version = version.split("-")[0] ?? version;
    const stored = this.read();
    this.seen = stored ?? this.version;
    if (stored === null) this.write(this.version);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** True once the app runs a version newer than the last one whose notes were opened. */
  hasNew(): boolean {
    return isNewer(this.version, this.seen);
  }

  /** The notes of this version were opened: the dot goes. */
  markSeen(): void {
    this.seen = this.version;
    this.write(this.version);
    for (const listener of this.listeners) listener();
  }

  private read(): string | null {
    try {
      return this.storage.getItem(WHATS_NEW_KEY);
    } catch {
      return null;
    }
  }

  private write(version: string): void {
    try {
      this.storage.setItem(WHATS_NEW_KEY, version);
    } catch {
      // A refused storage: the dot is gone for this run only.
    }
  }
}
