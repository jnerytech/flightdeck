import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Platform } from "../types.ts";

export interface BrowserWindow {
  localStorage: Platform["storage"];
  document: { hasFocus(): boolean };
}

/**
 * Desktop implementation: tokens in the OS keyring and tray state through the Rust commands in
 * src-tauri, everything else through the official Tauri 2 plugins.
 */
export function tauriPlatform(win: BrowserWindow = window): Platform {
  return {
    storage: win.localStorage,
    secrets: {
      get: (hostId) => invoke<string | null>("token_get", { hostId }),
      set: (hostId, token) => invoke("token_set", { hostId, token }),
      delete: (hostId) => invoke("token_delete", { hostId }),
    },
    async notify(notification) {
      const granted = (await isPermissionGranted()) || (await requestPermission()) === "granted";
      if (granted) sendNotification(notification);
    },
    isFocused: () => win.document.hasFocus(),
    openExternal: (url) => openUrl(url),
    onDeepLink(handler) {
      let stopped = false;
      const deliver = (urls: string[] | null) => {
        for (const url of urls ?? []) if (!stopped) handler(url);
      };
      void getCurrent().then(deliver);
      const unlisten = onOpenUrl(deliver);
      return () => {
        stopped = true;
        void unlisten.then((stop) => stop());
      };
    },
    setTrayStatus: (status) => invoke("tray_set_status", { ...status }),
    autostart: {
      supported: true,
      isEnabled: () => isEnabled(),
      setEnabled: (enabled) => (enabled ? enable() : disable()),
    },
    setCloseToTray: (enabled) => invoke("set_close_to_tray", { enabled }),
  };
}
