import { type FilePickerWindow, saveWithPicker } from "../save-file.ts";
import type { Platform } from "../types.ts";

export interface WebWindow extends FilePickerWindow {
  localStorage: Platform["storage"];
  document: { hasFocus(): boolean; title: string };
  location: { hash: string };
  open(url: string, target: string, features: string): unknown;
  addEventListener(type: "hashchange", listener: () => void): void;
  navigator?: { language?: string; clipboard?: { writeText(text: string): Promise<void> } };
  focus?(): void;
  removeEventListener(type: "hashchange", listener: () => void): void;
  Notification?: {
    permission: string;
    requestPermission(): Promise<string>;
    new (title: string, options?: { body?: string }): unknown;
  };
}

const LINK_HASH = "#link=";
const TITLE = "Flightdeck";

/**
 * Browser implementation. Secrets (and the vault's values) stay in memory only: a page has no safe place for tokens, so
 * the web build asks for them again after a reload. Deep links arrive as `#link=<encoded url>`.
 */
export function createWebPlatform(
  win: WebWindow = window as unknown as WebWindow,
  secrets: Map<string, string> = new Map(),
  vault: Map<string, string> = new Map(),
): Platform {
  const noop = async () => {};
  /** Deep-link handlers, also reached by a click on a notification that carries a link. */
  const linkHandlers = new Set<(url: string) => void>();
  return {
    storage: win.localStorage,
    secrets: {
      get: async (id) => secrets.get(id) ?? null, // NOSONAR: async by contract: a throw must reach the caller as a rejection
      set: async (id, value) => {
        // NOSONAR: async by contract: a throw must reach the caller as a rejection
        secrets.set(id, value);
      },
      delete: async (id) => {
        // NOSONAR: async by contract: a throw must reach the caller as a rejection
        secrets.delete(id);
      },
    },
    vault: {
      get: async (id) => vault.get(id) ?? null, // NOSONAR: async by contract: a throw must reach the caller as a rejection
      set: async (id, value) => {
        // NOSONAR: async by contract: a throw must reach the caller as a rejection
        vault.set(id, value);
      },
      delete: async (id) => {
        // NOSONAR: async by contract: a throw must reach the caller as a rejection
        vault.delete(id);
      },
      generateKey: async () => {
        // NOSONAR: async by contract: a throw must reach the caller as a rejection
        throw new Error("ssh-keygen needs the desktop app");
      },
      pickFile: () => Promise.resolve(null),
      removeFile: async () => {},
    },
    async notify({ title, body, link }) {
      const api = win.Notification;
      if (!api) return;
      const permission = api.permission === "granted" ? "granted" : await api.requestPermission();
      if (permission !== "granted") return;
      const shown = new api(title, { body }) as { onclick?: (() => void) | null };
      if (link) {
        shown.onclick = () => {
          win.focus?.();
          for (const handler of linkHandlers) handler(link);
        };
      }
    },
    isFocused: () => win.document.hasFocus(),
    async openExternal(url) {
      // NOSONAR: async by contract: a throw must reach the caller as a rejection
      win.open(url, "_blank", "noopener");
    },
    onDeepLink(handler) {
      const check = () => {
        const { hash } = win.location;
        if (hash.startsWith(LINK_HASH)) handler(decodeURIComponent(hash.slice(LINK_HASH.length)));
      };
      check();
      win.addEventListener("hashchange", check);
      linkHandlers.add(handler);
      return () => {
        linkHandlers.delete(handler);
        win.removeEventListener("hashchange", check);
      };
    },
    setTrayStatus({ count }) {
      win.document.title = count > 0 ? `(${count}) ${TITLE}` : TITLE;
      return Promise.resolve();
    },
    // A page has no tray: the badge goes to the title, the submenu nowhere.
    setTrayMenu: noop,
    onTrayAction: () => () => {},
    autostart: { supported: false, isEnabled: () => Promise.resolve(false), setEnabled: noop },
    setCloseToTray: noop,
    systemLanguage: () => win.navigator?.language ?? "",
    // A page's chrome belongs to the browser.
    setWindowTheme: noop,
    async copyText(text) {
      const clipboard = win.navigator?.clipboard;
      if (!clipboard) throw new Error("the clipboard is not available");
      await clipboard.writeText(text);
    },
    saveFile: (name, text) => saveWithPicker(win, name, text),
    async showMainWindow() {
      // NOSONAR: async by contract: a throw must reach the caller as a rejection
      win.focus?.();
    },
    // A page cannot start programs: "Abrir no terminal" copies the command instead.
    terminal: {
      supported: false,
      probe: () => Promise.resolve({ windows: false, wt: false }),
      open: noop,
    },
    // A page cannot listen to keys while it is not focused.
    globalShortcut: { supported: false, register: noop, unregister: noop },
    updater: { supported: false, check: () => Promise.resolve(null), install: noop },
  };
}
