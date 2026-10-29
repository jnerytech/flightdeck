import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type FilePickerWindow, saveWithPicker } from "../save-file.ts";
import type { Platform, TrayAction } from "../types.ts";

export interface BrowserWindow extends FilePickerWindow {
  localStorage: Platform["storage"];
  document: { hasFocus(): boolean };
  navigator: { clipboard: { writeText(text: string): Promise<void> } };
}

/**
 * Desktop implementation: tokens in the OS keyring and tray state through the Rust commands in
 * src-tauri, everything else through the official Tauri 2 plugins. `call` and `subscribe` stand in
 * for `invoke` and `listen` in tests.
 */
export function tauriPlatform(
  win: BrowserWindow = window,
  call: typeof invoke = invoke,
  subscribe: typeof listen = listen,
): Platform {
  return {
    storage: win.localStorage,
    secrets: {
      get: (hostId) => call<string | null>("token_get", { hostId }),
      set: (hostId, token) => call("token_set", { hostId, token }),
      delete: (hostId) => call("token_delete", { hostId }),
    },
    async notify(notification) {
      const granted = (await isPermissionGranted()) || (await requestPermission()) === "granted";
      // The desktop plugin reports no clicks, so the link has nowhere to go (docs/DECISIONS.md).
      if (granted) sendNotification({ title: notification.title, body: notification.body });
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
    setTrayMenu: (menu) => call("tray_set_menu", { ...menu }),
    // The Rust tray emits `tray-action` for each click in the "Precisa de você" submenu.
    onTrayAction(handler) {
      const unlisten = subscribe<TrayAction>("tray-action", (event) => handler(event.payload));
      return () => {
        void unlisten.then((stop) => stop());
      };
    },
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
    // WebView2's save dialog; no dialog plugin, so the Rust shell stays as it is.
    saveFile: (name, text) => saveWithPicker(win, name, text),
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
