import { type PickDocument, pickWithInput } from "../pick-file.ts";
import { type FilePickerWindow, saveWithPicker } from "../save-file.ts";
import type { Platform } from "../types.ts";

export interface WebWindow extends FilePickerWindow {
  localStorage: Platform["storage"];
  document: { hasFocus(): boolean; title: string; createElement?: PickDocument["createElement"] };
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
/** The web build has no shell: an API provider is "not configured", as a refusal the app already translates. */
const notHere = () =>
  Object.assign(new Error("assistant_not_configured"), { reason: "assistant_not_configured" });

export function createWebPlatform(
  win: WebWindow = window as unknown as WebWindow,
  secrets: Map<string, string> = new Map(),
  vault: Map<string, string> = new Map(),
): Platform {
  const noop = async () => {};
  /** Deep-link handlers, also reached by a click on a notification that carries a link. */
  const linkHandlers = new Set<(url: string) => void>();
  return {
    assistant: {
      supported: false,
      keyStatus: async () => ({ saved: false }),
      setKey: () => Promise.reject(notHere()),
      deleteKey: async () => {},
      test: () => Promise.reject(notHere()),
      models: async () => [],
      run: () => Promise.reject(notHere()),
      cancel: async () => {},
      vaultHits: async () => [],
    },
    storage: win.localStorage,
    secrets: {
      get: (id) => Promise.resolve(secrets.get(id) ?? null),
      set: (id, value) => {
        secrets.set(id, value);
        return Promise.resolve();
      },
      delete: (id) => {
        secrets.delete(id);
        return Promise.resolve();
      },
    },
    vault: {
      get: (id) => Promise.resolve(vault.get(id) ?? null),
      set: (id, value) => {
        vault.set(id, value);
        return Promise.resolve();
      },
      delete: (id) => {
        vault.delete(id);
        return Promise.resolve();
      },
      generateKey: () => Promise.reject(new Error("ssh-keygen needs the desktop app")),
      // A page picks a file through a file input, where the window can make one; else there is no
      // dialog, and the app offers no restore.
      canPick: Boolean(win.document?.createElement),
      pickFile: () =>
        win.document?.createElement
          ? pickWithInput(win.document as PickDocument)
          : Promise.resolve(null),
      removeFile: async () => {},
    },
    async notify({ title, body, link }) {
      const api = win.Notification;
      if (!api) return false;
      const permission = api.permission === "granted" ? "granted" : await api.requestPermission();
      if (permission !== "granted") return false;
      const shown = new api(title, { body }) as { onclick?: (() => void) | null };
      if (link) {
        shown.onclick = () => {
          win.focus?.();
          for (const handler of linkHandlers) handler(link);
        };
      }
      return true;
    },
    isFocused: () => win.document.hasFocus(),
    openExternal(url) {
      win.open(url, "_blank", "noopener");
      return Promise.resolve();
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
    onQuitRequested: () => () => {},
    quitNow: noop,
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
    showMainWindow() {
      win.focus?.();
      return Promise.resolve();
    },
    // A page cannot start programs: "Abrir no terminal" copies the command instead.
    terminal: {
      supported: false,
      probe: () => Promise.resolve({ windows: false, wt: false }),
      open: noop,
    },
    // A page cannot listen to keys while it is not focused.
    globalShortcut: { supported: false, register: noop, unregister: noop },
    updater: {
      supported: false,
      check: () => Promise.resolve(null),
      download: noop,
      installDownloaded: noop,
      install: noop,
    },
  };
}
