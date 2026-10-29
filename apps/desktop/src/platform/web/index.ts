import type { Platform } from "../types.ts";

export interface WebWindow {
  localStorage: Platform["storage"];
  document: { hasFocus(): boolean; title: string };
  location: { hash: string };
  open(url: string, target: string, features: string): unknown;
  addEventListener(type: "hashchange", listener: () => void): void;
  navigator?: { clipboard?: { writeText(text: string): Promise<void> } };
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
 * Browser implementation. Secrets stay in memory only: a page has no safe place for tokens, so
 * the web build asks for them again after a reload. Deep links arrive as `#link=<encoded url>`.
 */
export function createWebPlatform(
  win: WebWindow = window as unknown as WebWindow,
  secrets: Map<string, string> = new Map(),
): Platform {
  const noop = async () => {};
  return {
    storage: win.localStorage,
    secrets: {
      get: async (id) => secrets.get(id) ?? null,
      set: async (id, value) => {
        secrets.set(id, value);
      },
      delete: async (id) => {
        secrets.delete(id);
      },
    },
    async notify({ title, body }) {
      const api = win.Notification;
      if (!api) return;
      const permission = api.permission === "granted" ? "granted" : await api.requestPermission();
      if (permission === "granted") new api(title, { body });
    },
    isFocused: () => win.document.hasFocus(),
    async openExternal(url) {
      win.open(url, "_blank", "noopener");
    },
    onDeepLink(handler) {
      const check = () => {
        const { hash } = win.location;
        if (hash.startsWith(LINK_HASH)) handler(decodeURIComponent(hash.slice(LINK_HASH.length)));
      };
      check();
      win.addEventListener("hashchange", check);
      return () => win.removeEventListener("hashchange", check);
    },
    async setTrayStatus({ count }) {
      win.document.title = count > 0 ? `(${count}) ${TITLE}` : TITLE;
    },
    autostart: { supported: false, isEnabled: async () => false, setEnabled: noop },
    setCloseToTray: noop,
    async copyText(text) {
      const clipboard = win.navigator?.clipboard;
      if (!clipboard) throw new Error("área de transferência indisponível");
      await clipboard.writeText(text);
    },
    async showMainWindow() {
      win.focus?.();
    },
    // A page cannot start programs: "Abrir no terminal" copies the command instead.
    terminal: {
      supported: false,
      probe: async () => ({ windows: false, wt: false }),
      open: noop,
    },
    // A page cannot listen to keys while it is not focused.
    globalShortcut: { supported: false, register: noop, unregister: noop },
  };
}
