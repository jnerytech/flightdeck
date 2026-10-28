import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { Platform } from "./platform.ts";

export interface BrowserWindow {
  localStorage: Platform["storage"];
  document: { hasFocus(): boolean };
}

/** Platform backed by Tauri: tokens in the OS keyring (see src-tauri), native notifications. */
export function tauriPlatform(win: BrowserWindow = window): Platform {
  return {
    storage: win.localStorage,
    getToken: (hostId) => invoke<string | null>("token_get", { hostId }),
    setToken: (hostId, token) => invoke("token_set", { hostId, token }),
    deleteToken: (hostId) => invoke("token_delete", { hostId }),
    async notify(notification) {
      const granted = (await isPermissionGranted()) || (await requestPermission()) === "granted";
      if (granted) sendNotification(notification);
    },
    isFocused: () => win.document.hasFocus(),
  };
}
