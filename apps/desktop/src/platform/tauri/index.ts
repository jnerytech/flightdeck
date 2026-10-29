import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
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
  navigator: { clipboard: { writeText(text: string): Promise<void> } };
}

/**
 * Desktop implementation: tokens in the OS keyring and tray state through the Rust commands in
 * src-tauri, everything else through the official Tauri 2 plugins. `call` stands in for `invoke` in
 * tests.
 */
export function tauriPlatform(win: BrowserWindow = window, call: typeof invoke = invoke): Platform {
  return {
    storage: win.localStorage,
    secrets: {
      get: (hostId) => call<string | null>("token_get", { hostId }),
      set: (hostId, token) => call("token_set", { hostId, token }),
      delete: (hostId) => call("token_delete", { hostId }),
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
    setTrayStatus: (status) => call("tray_set_status", { ...status }),
    autostart: {
      supported: true,
      isEnabled: () => isEnabled(),
      setEnabled: (enabled) => (enabled ? enable() : disable()),
    },
    setCloseToTray: (enabled) => call("set_close_to_tray", { enabled }),
    // The webview's Clipboard API works from the click that asks for the copy.
    copyText: (text) => win.navigator.clipboard.writeText(text),
    showMainWindow: () => call("focus_main"),
    // Rust runs the program with the arguments as a list, never through a shell.
    terminal: {
      supported: true,
      probe: () => call<{ windows: boolean; wt: boolean }>("terminal_probe"),
      open: (program, args) => call("terminal_open", { program, args }),
    },
    globalShortcut: {
      supported: true,
      register: (accelerator, onPress) =>
        register(accelerator, (event) => {
          if (event.state === "Pressed") onPress();
        }),
      unregister: (accelerator) => unregister(accelerator),
    },
  };
}
