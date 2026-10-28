/**
 * Everything the app needs from its host environment. Two implementations: `tauri/` (desktop) and
 * `web/` (UI tests now, the PWA later). Nothing outside `platform/tauri` may import `@tauri-apps/*`;
 * a Biome rule enforces it.
 */

export interface Notification {
  title: string;
  body: string;
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
  autostart: {
    supported: boolean;
    isEnabled(): Promise<boolean>;
    setEnabled(enabled: boolean): Promise<void>;
  };
  /** Closing the window hides it to the tray instead of quitting. */
  setCloseToTray(enabled: boolean): Promise<void>;
}
