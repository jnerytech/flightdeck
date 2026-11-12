import type { T } from "../../i18n/index.ts";
import type { Platform } from "../../platform/types.ts";
import { DEFAULT_SHORTCUT, SHORTCUT_KEY, validateShortcut } from "../shortcuts/index.ts";

/** Preference stored in plain settings; anything but "false" means on. */
export const CLOSE_TO_TRAY_KEY = "flightdeck.closeToTray";
/** Phase 9: "false" turns off the look for app updates. */
export const NOTIFY_UPDATES_KEY = "flightdeck.notifyUpdates";
/** Issue #280: the app downloads a newer version by itself; "false" turns it off. */
export const AUTO_UPDATE_KEY = "flightdeck.autoUpdate";
/** Issue #100: "true" turns on the preview of moving a session to another host. */
export const TELEPORT_PREVIEW_KEY = "flightdeck.teleportPreview";

export interface Settings {
  closeToTray: boolean;
  autostart: boolean;
  autostartSupported: boolean;
  /** Accelerator in use (or tried last, when `shortcutProblem` is set). */
  globalShortcut: string;
  globalShortcutSupported: boolean;
  /** The OS refused the shortcut, typically because another program already uses it. */
  shortcutProblem: string | null;
  /** The last shortcut typed in the settings was not valid. */
  shortcutError: string | null;
  /** Phase 9: look for app updates at startup and every 6 h. */
  notifyUpdates: boolean;
  /** Issue #280: a newer version downloads by itself, to install on a restart (on by default). */
  autoUpdate: boolean;
  updaterSupported: boolean;
  /** Issue #100: the preview of moving a session to another host (off by default). */
  teleportPreview: boolean;
}

/** The settings' part of the app's state (#1596). */
export interface SettingsSliceState {
  settings: Settings;
}

/** The part of the platform the settings need: what it keeps and what the OS can do. */
export type SettingsPlatform = Pick<
  Platform,
  "storage" | "setCloseToTray" | "showMainWindow" | "autostart" | "globalShortcut" | "updater"
>;

/** Defaults: close to tray on, start with Windows off, updates on, the teleport preview off. */
export const initialSettingsState = (platform: SettingsPlatform): SettingsSliceState => ({
  settings: {
    closeToTray: true,
    autostart: false,
    autostartSupported: platform.autostart.supported,
    globalShortcut: DEFAULT_SHORTCUT,
    globalShortcutSupported: platform.globalShortcut.supported,
    shortcutProblem: null,
    shortcutError: null,
    notifyUpdates: true,
    autoUpdate: true,
    updaterSupported: platform.updater.supported,
    teleportPreview: false,
  },
});

/** What the settings read and ask through the app's store. */
export interface SettingsCore {
  state(): SettingsSliceState;
  update(patch: Partial<SettingsSliceState>): void;
  platform: SettingsPlatform;
  /** The app's texts in the current language. */
  t(): T;
  /** What the global shortcut does once the window is in front: opens the global search. */
  onShortcut(): void;
}

/** The person's own choices on this machine: tray, autostart, shortcut, updates (#1596: a slice). */
export class SettingsSlice {
  /** Accelerator currently registered with the OS. */
  private shortcut: string | null = null;

  constructor(private readonly core: SettingsCore) {}

  /** Reads what was saved and what the OS says, at each start. */
  async load(): Promise<void> {
    const { storage, autostart } = this.core.platform;
    const closeToTray = storage.getItem(CLOSE_TO_TRAY_KEY) !== "false";
    await this.core.platform.setCloseToTray(closeToTray);
    const autostartOn = autostart.supported && (await autostart.isEnabled());
    const globalShortcut = storage.getItem(SHORTCUT_KEY) ?? DEFAULT_SHORTCUT;
    const notifyUpdates = storage.getItem(NOTIFY_UPDATES_KEY) !== "false";
    const autoUpdate = storage.getItem(AUTO_UPDATE_KEY) !== "false";
    // A preview: on only when the person turned it on.
    const teleportPreview = storage.getItem(TELEPORT_PREVIEW_KEY) === "true";
    this.patch({
      closeToTray,
      autostart: autostartOn,
      globalShortcut,
      notifyUpdates,
      autoUpdate,
      teleportPreview,
    });
  }

  /** Registers the saved shortcut with the OS, when the OS can. */
  async registerSaved(): Promise<void> {
    if (!this.core.platform.globalShortcut.supported) return;
    await this.register(this.core.state().settings.globalShortcut);
  }

  async setCloseToTray(enabled: boolean): Promise<void> {
    this.core.platform.storage.setItem(CLOSE_TO_TRAY_KEY, String(enabled));
    await this.core.platform.setCloseToTray(enabled);
    this.patch({ closeToTray: enabled });
  }

  async setAutostart(enabled: boolean): Promise<void> {
    await this.core.platform.autostart.setEnabled(enabled);
    this.patch({ autostart: enabled });
  }

  /** Validates, swaps the registration and saves the new shortcut only if the OS took it. */
  async setGlobalShortcut(text: string): Promise<void> {
    const check = validateShortcut(text, this.core.t());
    if (!check.ok) {
      this.patch({ shortcutError: check.error });
      return;
    }
    const { globalShortcut } = this.core.platform;
    if (this.shortcut) await globalShortcut.unregister(this.shortcut);
    this.shortcut = null;
    if (await this.register(check.value)) {
      this.core.platform.storage.setItem(SHORTCUT_KEY, check.value);
    }
  }

  setAutoUpdate(enabled: boolean): void {
    this.core.platform.storage.setItem(AUTO_UPDATE_KEY, String(enabled));
    this.patch({ autoUpdate: enabled });
  }

  setNotifyUpdates(enabled: boolean): void {
    this.core.platform.storage.setItem(NOTIFY_UPDATES_KEY, String(enabled));
    this.patch({ notifyUpdates: enabled });
  }

  setTeleportPreview(enabled: boolean): void {
    this.core.platform.storage.setItem(TELEPORT_PREVIEW_KEY, String(enabled));
    this.patch({ teleportPreview: enabled });
  }

  private async register(accelerator: string): Promise<boolean> {
    try {
      await this.core.platform.globalShortcut.register(accelerator, () => {
        void this.core.platform.showMainWindow();
        this.core.onShortcut();
      });
      this.shortcut = accelerator;
      this.patch({ globalShortcut: accelerator, shortcutProblem: null, shortcutError: null });
      return true;
    } catch {
      this.patch({
        shortcutProblem: this.core.t()("messages.shortcutTaken", { accelerator }),
        shortcutError: null,
      });
      return false;
    }
  }

  private patch(patch: Partial<Settings>): void {
    this.core.update({ settings: { ...this.core.state().settings, ...patch } });
  }
}
