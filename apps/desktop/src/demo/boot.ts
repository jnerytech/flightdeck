import { z } from "zod";
import { LANG_KEY, LANGS, type Lang } from "../i18n/index.ts";
import { saveHosts } from "../lib/hosts.ts";
import type { Route } from "../lib/router.ts";
import { THEME_KEY, type ThemeMode } from "../lib/theme.ts";
import type { Platform } from "../platform/types.ts";

const DemoHost = z.object({ id: z.string(), name: z.string(), url: z.string(), token: z.string() });

/** A host the demo runs (scripts/demo-seed.ts), already paired: id, name, address and token. */
export type DemoHost = z.infer<typeof DemoHost>;

/** The hosts handed to the web entry (`VITE_DEMO_HOSTS`, JSON); none when absent or invalid. */
export function parseDemoHosts(json: string | undefined): DemoHost[] {
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

const THEMES: readonly ThemeMode[] = ["light", "dark", "system"];

/** `?theme=` and `?lang=` of the demo's address, stored as the user's choices (prints). */
export function applyDemoPrefs(storage: Platform["storage"], search: string): void {
  const params = new URLSearchParams(search);
  const theme = params.get("theme") as ThemeMode | null;
  const lang = params.get("lang") as Lang | null;
  if (theme && THEMES.includes(theme)) storage.setItem(THEME_KEY, theme);
  if (lang && LANGS.includes(lang)) storage.setItem(LANG_KEY, lang);
}

/** index.html with the web entry when `FLIGHTDECK_ENTRY=web` (the demo and the prints). */
export function entryHtml(html: string, entry: string | undefined): string {
  return entry === "web" ? html.replace("/src/main.tsx", "/src/main.web.tsx") : html;
}
