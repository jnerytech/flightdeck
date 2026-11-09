import { z } from "zod";
import { LANG_KEY, LANGS, type Lang } from "../i18n/index.ts";
import { saveHosts } from "../lib/hosts.ts";
import type { Route } from "../lib/router.ts";
import { THEME_KEY, type ThemeMode } from "../lib/theme.ts";
import { WORKSPACE_KEY } from "../lib/workspace.ts";
import type { Platform } from "../platform/types.ts";

const DemoHost = z.object({ id: z.string(), name: z.string(), url: z.string(), token: z.string() });

/** A host the demo runs (scripts/demo-seed.ts), already paired: id, name, address and token. */
export type DemoHost = z.infer<typeof DemoHost>;

/**
 * The hosts handed to the web entry (`VITE_DEMO_HOSTS`, JSON); none when absent or invalid, and none
 * when the address asks `?hosts=none` (the first-run screen's print, #1052).
 */
export function parseDemoHosts(json: string | undefined, search = ""): DemoHost[] {
  if (new URLSearchParams(search).get("hosts") === "none") return [];
  try {
    return z.array(DemoHost).parse(JSON.parse(json ?? "[]"));
  } catch {
    return [];
  }
}

/**
 * Stores the demo's hosts as if the user had added them, tokens included, before the app starts:
 * the demo opens already paired, without bending the rule that a link only prefills the form.
 */
export function seedDemoHosts(
  storage: Platform["storage"],
  secrets: Map<string, string>,
  hosts: DemoHost[],
): void {
  saveHosts(
    storage,
    hosts.map(({ id, name, url }) => ({ id, name, url })),
  );
  for (const host of hosts) secrets.set(host.id, host.token);
}

/** `?route=<json>` of the demo's address: the screen a print opens on. */
export function initialRoute(search: string): Route | null {
  const raw = new URLSearchParams(search).get("route");
  try {
    const route = JSON.parse(raw ?? "null") as Route | null;
    return typeof route?.name === "string" ? route : null;
  } catch {
    return null;
  }
}

const THEMES: ReadonlySet<ThemeMode> = new Set<ThemeMode>(["light", "dark", "system"]);

/**
 * `?theme=` and `?lang=` of the demo's address, stored as the user's choices (prints). An address
 * with `?route=` shows that one screen: it opens on a fresh window, not on the tabs and split an
 * earlier page of the same browser kept.
 */
export function applyDemoPrefs(storage: Platform["storage"], search: string): void {
  const params = new URLSearchParams(search);
  if (params.has("route")) storage.setItem(WORKSPACE_KEY, "null");
  const theme = params.get("theme") as ThemeMode | null;
  const lang = params.get("lang") as Lang | null;
  if (theme && THEMES.has(theme)) storage.setItem(THEME_KEY, theme);
  if (lang && LANGS.includes(lang)) storage.setItem(LANG_KEY, lang);
}

export { entryHtml } from "./entry-html.ts";

/**
 * What the store gets in the demo: with seeded hosts, a long wait between attempts, so a host that
 * does not answer stays offline (or reconnecting) long enough for the prints instead of flickering.
 * The e2e asks for `?reconnect=fast` instead: a first connection lost under load must heal in
 * seconds, not after the long wait.
 */
export function demoStoreOptions(
  hosts: DemoHost[],
  search = "",
): { baseDelayMs?: number; maxDelayMs?: number } {
  if (hosts.length === 0) return {};
  if (new URLSearchParams(search).get("reconnect") === "fast") {
    return { baseDelayMs: 1000, maxDelayMs: 4000 };
  }
  return { baseDelayMs: 60_000 };
}

/** The key the demo's backup folder keeps its files under, in the page's storage (survives a reload). */
export const DEMO_BACKUP_FOLDER_KEY = "flightdeck.demoBackupFolder";
/** The path the demo's folder dialog gives. */
export const DEMO_BACKUP_FOLDER = "/demo/backups";

/** The shell's rule: only files named like a backup are written, listed or removed. */
const BACKUP_NAME = /^flightdeck-backup-\d{8}-\d{6}\.fdbackup$/;

interface DemoFolder {
  chosen: boolean;
  files: Record<string, string>;
}

/**
 * A stand-in for the desktop's backup folder (issue #1264), for the e2e: the web build has none.
 * Its files live in the page's storage, so a page loaded again finds them, as a restart finds a folder.
 */
export function demoBackupFolder(platform: Platform): NonNullable<Platform["backupFolder"]> {
  const read = (): DemoFolder => {
    try {
      const raw = JSON.parse(
        platform.storage.getItem(DEMO_BACKUP_FOLDER_KEY) ?? "null",
      ) as Partial<DemoFolder> | null;
      return { chosen: raw?.chosen === true, files: raw?.files ?? {} };
    } catch {
      return { chosen: false, files: {} };
    }
  };
  const write = (folder: DemoFolder) =>
    platform.storage.setItem(DEMO_BACKUP_FOLDER_KEY, JSON.stringify(folder));
  const named = (name: string) => {
    if (!BACKUP_NAME.test(name)) throw new Error("not a backup file name");
  };
  return {
    pick: () => {
      write({ ...read(), chosen: true });
      return Promise.resolve(DEMO_BACKUP_FOLDER);
    },
    current: () => Promise.resolve(read().chosen ? DEMO_BACKUP_FOLDER : null),
    write: async (name, text) => {
      named(name);
      const folder = read();
      write({ ...folder, files: { ...folder.files, [name]: text } });
    },
    list: () => Promise.resolve(Object.keys(read().files).sort((a, b) => a.localeCompare(b))),
    remove: async (name) => {
      named(name);
      const folder = read();
      const { [name]: _gone, ...files } = folder.files;
      write({ ...folder, files });
    },
  };
}

/**
 * The e2e asks for `?update=<version>`: the demo's updater then offers that version and "downloads"
 * it, so the update card (#490) can be driven in a page, which has no Tauri updater. Without it, or
 * with something that is not a version, the platform is the browser's as it is.
 */
export function demoPlatform(platform: Platform, search = ""): Platform {
  const params = new URLSearchParams(search);
  const withFolder =
    params.get("backupFolder") === "demo"
      ? { ...platform, backupFolder: demoBackupFolder(platform) }
      : platform;
  const version = params.get("update");
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) return withFolder;
  const nothing = () => Promise.resolve();
  return {
    ...withFolder,
    updater: {
      supported: true,
      check: () => Promise.resolve({ version, notes: "" }),
      download: nothing,
      installDownloaded: nothing,
      install: nothing,
    },
  };
}

/** What `demoToast` needs of the store. */
export interface ToastTarget {
  success(text: string): void;
  i18n: { t: (key: "toast.rootAdded", params: Record<string, string>) => string };
}

/**
 * The prints send `flightdeck:demo-toast` to the page (#581) right before a shot: each one shows a
 * success toast in the page's language, so a print shows where the toasts sit (over the status bar,
 * and over the update card with `update=`). A toast at boot would be gone by the shot. Returns the
 * way to stop listening.
 */
export function demoToast(store: ToastTarget, page: EventTarget): () => void {
  const show = () =>
    store.success(store.i18n.t("toast.rootAdded", { folder: "~/projetos/loja", host: "alfa" }));
  page.addEventListener("flightdeck:demo-toast", show);
  return () => page.removeEventListener("flightdeck:demo-toast", show);
}
