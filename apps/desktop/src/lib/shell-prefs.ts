import type { Platform } from "../platform/types.ts";

/** Where the shell's switches are kept on this computer. */
export const SHELL_PREFS_KEY = "flightdeck.shellPrefs";

/** What the person hides in the shell: the New and Beta badges, and What's new (issue #282). */
export interface ShellPrefsValue {
  hideBadges: boolean;
  hideWhatsNew: boolean;
}

const NOTHING_HIDDEN: ShellPrefsValue = { hideBadges: false, hideWhatsNew: false };

/** What is kept, read leniently: a key that is missing or not a boolean hides nothing. */
function read(storage: Platform["storage"]): ShellPrefsValue {
  try {
    const kept: unknown = JSON.parse(storage.getItem(SHELL_PREFS_KEY) ?? "{}");
    const flags =
      typeof kept === "object" && kept !== null ? (kept as Record<string, unknown>) : {};
    return {
      hideBadges: flags.hideBadges === true,
      hideWhatsNew: flags.hideWhatsNew === true,
    };
  } catch {
    return NOTHING_HIDDEN;
  }
}

export class ShellPrefs {
  /** Replaced, never changed in place, so a reader can tell when it moved. */
  value: ShellPrefsValue;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Platform["storage"]) {
    this.value = read(storage);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(patch: Partial<ShellPrefsValue>): void {
    this.value = { ...this.value, ...patch };
    this.storage.setItem(SHELL_PREFS_KEY, JSON.stringify(this.value));
    for (const listener of this.listeners) listener();
  }
}
