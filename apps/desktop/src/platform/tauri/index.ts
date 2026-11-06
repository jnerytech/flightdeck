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
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { badgeRgba } from "../../lib/badge-icon.ts";
import { type FilePickerWindow, saveWithPicker } from "../save-file.ts";
import type { GeneratedKey, PickedFile, Platform, TrayAction } from "../types.ts";

export interface BrowserWindow extends FilePickerWindow {
  localStorage: Platform["storage"];
  document: { hasFocus(): boolean };
  navigator: { language?: string; clipboard: { writeText(text: string): Promise<void> } };
}

/**
 * Desktop implementation: tokens in the OS keyring and tray state through the Rust commands in
 * src-tauri, everything else through the official Tauri 2 plugins. `call` and `subscribe` stand in
 * for `invoke` and `listen` in tests.
 */
/**
 * A command of the AI assistant's Rust side. It rejects with a refusal object `{ reason, params? }`,
 * which reaches the caller as it came; anything else (Tauri rejects a malformed argument with a plain
 * string, before the command runs) is `assistant_bad_output`.
 */
function shell<T>(call: typeof invoke, command: string, args: Record<string, unknown>): Promise<T> {
  return call<T>(command, args).catch((error: unknown) => {
    const reason = (error as { reason?: unknown } | null | undefined)?.reason;
    return Promise.reject(typeof reason === "string" ? error : { reason: "assistant_bad_output" });
  });
}

export function tauriPlatform(
  win: BrowserWindow = window,
  call: typeof invoke = invoke,
  subscribe: typeof listen = listen,
): Platform {
  /** The update found by the last check, installed by `updater.install`. */
  let pending: Update | null = null;
  /** The update `updater.download` fetched already (issue #280), installed without a second download. */
  let downloaded: Update | null = null;
  return {
    assistant: {
      supported: true,
      keyStatus: (provider) =>
        shell<{ saved: boolean; last4?: string }>(call, "assistant_key_status", { provider }),
      setKey: (provider, key) =>
        shell<{ last4: string }>(call, "assistant_key_set", { provider, key }),
      deleteKey: (provider) => shell(call, "assistant_key_delete", { provider }),
      test: (provider) => shell(call, "assistant_test", { provider }),
      models: (provider) => shell(call, "assistant_models", { provider }),
      run: (request, vaultIds, { provider, denyDataCollection }) =>
        shell(call, "assistant_run", { provider, request, vaultIds, denyDataCollection }),
      cancel: (requestId) => shell(call, "assistant_cancel", { requestId }),
      vaultHits: (text, ids) => shell<string[]>(call, "vault_hits", { text, ids }),
    },
    storage: win.localStorage,
    secrets: {
      get: (hostId) => call<string | null>("token_get", { hostId }),
      set: (hostId, token) => call("token_set", { hostId, token }),
      delete: (hostId) => call("token_delete", { hostId }),
    },
    vault: {
      get: (id) => call<string | null>("vault_get", { id }),
      set: (id, value) => call("vault_set", { id, value }),
      delete: (id) => call("vault_delete", { id }),
      generateKey: (comment) => call<GeneratedKey>("vault_generate_key", { comment }),
      pickFile: () => call<PickedFile | null>("vault_pick_file"),
      removeFile: (path) => call("vault_remove_file", { path }),
    },
    pickFolder: () => call<string | null>("pick_folder"),
    async notify(notification) {
      const granted = (await isPermissionGranted()) || (await requestPermission()) === "granted";
      // The desktop plugin reports no clicks, so the link has nowhere to go (docs/DECISIONS.md).
      if (granted) sendNotification({ title: notification.title, body: notification.body });
      return false;
    },
    isFocused: () => win.document.hasFocus(),
    openExternal: (url) => openUrl(url),
    // Through the shell's own command, which opens only plain documents of this machine.
    openPath: (path) => call("open_result", { path, reveal: false }),
    revealPath: (path) => call("open_result", { path, reveal: true }),
    // The app's log file, written by the shell's own commands (the webview never sees a path).
    logs: {
      write: (lines) => call("append_log", { lines }),
      tail: (lines) => call<string[]>("read_log_tail", { lines }),
      openFolder: () => call("open_logs_dir"),
    },
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
    setBadge: async (count) => {
      await call("set_unread_badge", { rgba: badgeRgba(count) ?? [] });
    },
    setTrayMenu: (menu) => call("tray_set_menu", { ...menu }),
    // Issue #402: the tray's Quit asks the app first, so a downloaded update installs on the way out.
    onQuitRequested(handler) {
      const unlisten = subscribe("quit-requested", () => handler());
      return () => void unlisten.then((stop) => stop());
    },
    quitNow: async () => {
      await call("quit_now");
    },
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
    systemLanguage: () => win.navigator.language ?? "",
    // What getCurrentWindow().setTheme() sends; needs core:window:allow-set-theme.
    setWindowTheme: (theme) => call("plugin:window|set_theme", { label: "main", value: theme }),
    // Rust runs the program with the arguments as a list, never through a shell.
    terminal: {
      supported: true,
      probe: () => call<{ windows: boolean; wt: boolean }>("terminal_probe"),
      open: (program, args) => call("terminal_open", { program, args }),
    },
    // WebView2's save dialog (the dialog plugin is only used from Rust: vault_pick_file, pick_folder).
    saveFile: (name, text) => saveWithPicker(win, name, text),
    globalShortcut: {
      supported: true,
      register: (accelerator, onPress) =>
        register(accelerator, (event) => {
          if (event.state === "Pressed") onPress();
        }),
      unregister: (accelerator) => unregister(accelerator),
    },
    updater: {
      supported: true,
      check: async () => {
        pending = await check();
        return pending ? { version: pending.version, notes: pending.body ?? "" } : null;
      },
      // The plugin checks the signature against plugins.updater.pubkey before installing.
      download: async () => {
        if (!pending) throw new Error("no update found to download");
        await pending.download();
        downloaded = pending;
      },
      installDownloaded: async () => {
        // Windows' passive installer starts the app again by default (/R, AUTOLAUNCHAPP): Quit means quit.
        if (downloaded) await downloaded.install({ restartAfterInstall: false });
      },
      install: async () => {
        if (!pending) throw new Error("no update found to install");
        if (downloaded === pending) await pending.install();
        else await pending.downloadAndInstall();
        await relaunch();
      },
    },
  };
}
