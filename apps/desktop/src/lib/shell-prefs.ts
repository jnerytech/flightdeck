import type { Platform } from "../platform/types.ts";

/** Where the shell's switches are kept on this computer. */
export const SHELL_PREFS_KEY = "flightdeck.shellPrefs";

/** What the person hides in the shell: the New and Beta badges, and What's new (issue #282). */
export interface ShellPrefsValue {
  hideBadges: boolean;
  hideWhatsNew: boolean;
}

export class ShellPrefs {
  /** Replaced, never changed in place, so a reader can tell when it moved. */
  value: ShellPrefsValue = { hideBadges: false, hideWhatsNew: false };
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Platform["storage"]) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(_patch: Partial<ShellPrefsValue>): void {}
}
