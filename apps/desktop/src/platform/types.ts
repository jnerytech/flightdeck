/**
 * Everything the app needs from its host environment. Two implementations: `tauri/` (desktop) and
 * `web/` (UI tests now, the PWA later). Nothing outside `platform/tauri` may import `@tauri-apps/*`;
 * a Biome rule enforces it.
 */

export interface Notification {
  title: string;
  body: string;
  /** `flightdeck://` link opened by a click on it, where the platform supports that (phase 8). */
  link?: string;
}

/** One open request in the tray's "Precisa de você" submenu (phase 8). */
export interface TrayMenuEntry {
  /** `hostId/requestId`, sent back with the action. */
  key: string;
  /** `host · sessão · ferramenta: resumo da entrada`. */
  label: string;
  /** Gates only open: they ask for reading. */
  actions: TrayActionKind[];
}

export type TrayActionKind = "approve" | "deny" | "open";

/** The submenu: up to 10 requests, then "e mais N…" (which opens the app). */
export interface TrayMenu {
  items: TrayMenuEntry[];
  more: number;
}

/** A click in the submenu; `key` is "more" for "e mais N…". */
export interface TrayAction {
  key: string;
  action: TrayActionKind;
}

/** What the tray icon shows: the number of open requests and the tooltip text. */
export interface TrayStatus {
  count: number;
  tooltip: string;
}

export interface Platform {
  /** Non-secret settings (host names and URLs, preferences). */
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  /** Host tokens; never stored in `storage`. */
  secrets: {
    get(id: string): Promise<string | null>;
    set(id: string, value: string): Promise<void>;
    delete(id: string): Promise<void>;
  };
  notify(notification: Notification): Promise<void>;
  isFocused(): boolean;
  openExternal(url: string): Promise<void>;
  /** Delivers `flightdeck://` links, including the one the app was opened with. */
  onDeepLink(handler: (url: string) => void): () => void;
  setTrayStatus(status: TrayStatus): Promise<void>;
  /** Rebuilds the "Precisa de você" submenu (phase 8). */
  setTrayMenu(menu: TrayMenu): Promise<void>;
  /** Clicks in that submenu: approve and deny answer without opening the window. */
  onTrayAction(handler: (action: TrayAction) => void): () => void;
  autostart: {
    supported: boolean;
    isEnabled(): Promise<boolean>;
    setEnabled(enabled: boolean): Promise<void>;
  };
  /** Closing the window hides it to the tray instead of quitting. */
  setCloseToTray(enabled: boolean): Promise<void>;
  copyText(text: string): Promise<void>;
  /** Saves `text` through the system's save dialog; `false` when the user cancels. */
  saveFile(name: string, text: string): Promise<boolean>;
  /** Brings the main window to the front (from the tray, minimized or behind others). */
  showMainWindow(): Promise<void>;
  /**
   * Terminals on this machine (phase 8), opened by the Rust shell with the arguments as a list.
   * Tests inject a fake: the real one is never called from them.
   */
  terminal: {
    supported: boolean;
    /** Windows, and whether Windows Terminal (`wt.exe`) is installed. */
    probe(): Promise<{ windows: boolean; wt: boolean }>;
    open(program: string, args: string[]): Promise<void>;
  };
  /** System-wide shortcut, active with the app in the background. */
  globalShortcut: {
    supported: boolean;
    /** Rejects when the OS refuses it, typically because another program already uses it. */
    register(accelerator: string, onPress: () => void): Promise<void>;
    unregister(accelerator: string): Promise<void>;
  };
}
