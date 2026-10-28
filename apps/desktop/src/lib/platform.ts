import type { Notification } from "./notify.ts";

/** Everything the app needs from the host OS; the Tauri adapter implements it. */
export interface Platform {
  /** Non-secret settings (host names and URLs). */
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  /** Host tokens live in the OS credential store, never in `storage`. */
  getToken(hostId: string): Promise<string | null>;
  setToken(hostId: string, token: string): Promise<void>;
  deleteToken(hostId: string): Promise<void>;
  notify(notification: Notification): Promise<void>;
  isFocused(): boolean;
}
