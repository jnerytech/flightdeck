import type { Platform } from "../platform/types.ts";

export type ThemeMode = "light" | "dark" | "system";
export type Theme = "light" | "dark";

/** Where the choice is kept; "system" (the default) when absent. */
export const THEME_KEY = "flightdeck.theme";
export const DARK_QUERY = "(prefers-color-scheme: dark)";

const MODES: readonly ThemeMode[] = ["light", "dark", "system"];

/** What the controller touches: the root element's classes and the system's media queries. */
export interface ThemeEnv {
  root: { classList: { toggle(name: string, force: boolean): unknown } };
  matchMedia(query: string): {
    matches: boolean;
    addEventListener(type: "change", listener: () => void): void;
    removeEventListener(type: "change", listener: () => void): void;
  };
}

/** The page's own <html> and media queries; `null` outside a DOM (tests of the store alone). */
const documentEnv = (): ThemeEnv | null =>
  typeof document === "undefined"
    ? null
    : { root: document.documentElement, matchMedia: (q) => window.matchMedia(q) };

/**
 * Light, dark or the system's (live): the `dark` class on <html>, the Tauri window's title bar and
 * the stored choice.
 */
export class ThemeController {
  mode: ThemeMode = "system";
  resolved: Theme = "light";
  private readonly listeners = new Set<() => void>();
  private stopSystem: (() => void) | null = null;

  constructor(
    private readonly platform: Pick<Platform, "storage" | "setWindowTheme">,
    private readonly env: ThemeEnv | null = documentEnv(),
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): void {
    this.stop();
    const env = this.env;
    if (!env) return;
    const stored = this.platform.storage.getItem(THEME_KEY) as ThemeMode | null;
    this.mode = stored && MODES.includes(stored) ? stored : "system";
    const system = env.matchMedia(DARK_QUERY);
    const onSystem = () => {
      if (this.mode === "system") this.apply();
    };
    system.addEventListener("change", onSystem);
    this.stopSystem = () => system.removeEventListener("change", onSystem);
    this.apply(false);
    this.syncWindow();
  }

  stop(): void {
    this.stopSystem?.();
    this.stopSystem = null;
  }

  setMode(mode: ThemeMode): void {
    this.mode = mode;
    this.platform.storage.setItem(THEME_KEY, mode);
    this.apply();
    this.syncWindow();
  }

  /** Light ↔ dark, from what shows now (the palette's "Alternar tema"). */
  toggle(): void {
    this.setMode(this.resolved === "dark" ? "light" : "dark");
  }

  /** Shows the theme; `notify` is off for the first one, which is no change. */
  private apply(notify = true): void {
    const env = this.env as ThemeEnv;
    const systemDark = env.matchMedia(DARK_QUERY).matches;
    this.resolved = this.mode === "system" ? (systemDark ? "dark" : "light") : this.mode;
    env.root.classList.toggle("dark", this.resolved === "dark");
    if (notify) for (const listener of this.listeners) listener();
  }

  /** The window's title bar: a fixed choice, or `null` so it follows the system by itself. */
  private syncWindow(): void {
    void this.platform.setWindowTheme(this.mode === "system" ? null : this.mode);
  }
}
