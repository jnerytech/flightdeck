import type { Platform } from "../platform/types.ts";
import type { Theme } from "./theme.ts";

export type TerminalKeyAction =
  | "copy"
  | "paste"
  | "search"
  | "snippets"
  | "newline"
  | TerminalZoom
  | "pass";

/** A step of the terminal's zoom: one point bigger, one smaller, or back to the default size. */
export type TerminalZoom = "zoomIn" | "zoomOut" | "zoomReset";

export interface TerminalKey {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

const KEY_ACTIONS: Record<string, TerminalKeyAction> = {
  c: "copy",
  v: "paste",
  f: "search",
  // Phase 18: the command snippets of this terminal's host and of the app.
  " ": "snippets",
};

const ZOOM_KEYS: Record<string, TerminalZoom> = {
  "=": "zoomIn",
  "+": "zoomIn",
  "-": "zoomOut",
  _: "zoomOut",
  "0": "zoomReset",
};

/** What Claude Code reads as "a new line, do not submit": ESC then CR, the same as Alt+Enter (what its /terminal-setup binds Shift+Enter to). */
export const NEWLINE_SEQUENCE = "\u001b\r";

/**
 * Ctrl+Shift+C/V/F/Space are the app's. Ctrl+C goes to the process (it is the interrupt), except on
 * Windows while something is selected: there it copies, as in Windows Terminal.
 */
export function terminalKeyAction(
  event: TerminalKey,
  context: { windows?: boolean; selected?: boolean } = {},
): TerminalKeyAction {
  // Shift+Enter alone is a new line in the prompt: xterm would send the same CR as Enter, which submits.
  if (
    event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    event.key === "Enter"
  ) {
    return "newline";
  }
  if (event.altKey || event.metaKey || !event.ctrlKey) return "pass";
  // Zoom, as in Windows Terminal and VS Code: Ctrl with =/+, -/_ or 0, Shift or not (#476).
  const zoom = ZOOM_KEYS[event.key];
  if (zoom) return zoom;
  if (!event.shiftKey) {
    return context.windows && context.selected && event.key.toLowerCase() === "c" ? "copy" : "pass";
  }
  return KEY_ACTIONS[event.key.toLowerCase()] ?? "pass";
}

/** Ctrl+wheel zooms the terminal (#476): up is bigger, down smaller; the wheel alone scrolls. */
export function terminalWheelAction(event: {
  ctrlKey: boolean;
  deltaY: number;
}): TerminalZoom | null {
  if (!event.ctrlKey || event.deltaY === 0) return null;
  return event.deltaY < 0 ? "zoomIn" : "zoomOut";
}

/** Whether the app runs on Windows, from the browser's user agent (WebView2 says so; macOS and Linux do not). */
export function isWindowsHost(userAgent: string): boolean {
  return /\bWindows\b/i.test(userAgent);
}

export interface TerminalColors {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
}

const COLORS: Record<Theme, TerminalColors> = {
  light: {
    background: "#fafafa",
    foreground: "#1f2430",
    cursor: "#5e6ad2",
    selectionBackground: "#c7cbf2",
  },
  dark: {
    background: "#121316",
    foreground: "#e6e8ee",
    cursor: "#8a93f0",
    selectionBackground: "#343a73",
  },
};

/** The terminal's colors for a theme (xterm reads sRGB, the tokens are oklch). */
export function terminalTheme(theme: Theme): TerminalColors {
  return COLORS[theme];
}

/** The colors xterm paints find matches with (it reads #RRGGBB only). */
export interface FindDecorations {
  matchBackground?: string;
  matchBorder?: string;
  matchOverviewRuler: string;
  activeMatchBackground?: string;
  activeMatchBorder?: string;
  activeMatchColorOverviewRuler: string;
}

export const FIND_DECORATIONS: FindDecorations = {
  matchBackground: "#8a6d1c",
  matchOverviewRuler: "#8a6d1c",
  activeMatchBackground: "#c2571a",
  activeMatchColorOverviewRuler: "#c2571a",
};

export const TERMINAL_FONT_KEY = "flightdeck.terminal-font";
export const TERMINAL_FONT_MIN = 10;
export const TERMINAL_FONT_MAX = 24;
export const TERMINAL_FONT_DEFAULT = 13;
export const TERMINAL_FONT_FAMILY = '"Cascadia Mono", Consolas, monospace';

const clampFont = (size: number) =>
  Math.min(TERMINAL_FONT_MAX, Math.max(TERMINAL_FONT_MIN, Math.round(size)));

/** The terminal's font size in px, kept across starts. */
export class TerminalFontController {
  value: number;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Platform["storage"]) {
    const stored = Number(storage.getItem(TERMINAL_FONT_KEY));
    this.value = Number.isFinite(stored) && stored > 0 ? clampFont(stored) : TERMINAL_FONT_DEFAULT;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(size: number): void {
    this.value = clampFont(size);
    this.storage.setItem(TERMINAL_FONT_KEY, String(this.value));
    for (const listener of this.listeners) listener();
  }

  /** A zoom step from the terminal's keys or wheel: one point either way, or back to the default. */
  zoom(step: TerminalZoom): void {
    if (step === "zoomReset") this.set(TERMINAL_FONT_DEFAULT);
    else this.set(this.value + (step === "zoomIn" ? 1 : -1));
  }
}

export const TERMINAL_READER_KEY = "flightdeck.terminal-reader";

/**
 * Whether the terminal speaks to screen readers (#476): xterm's screen reader mode, which keeps an
 * accessible copy of the output. Off at first (long output draws more slowly), kept across starts.
 */
export class TerminalReaderSetting {
  value: boolean;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Platform["storage"]) {
    this.value = storage.getItem(TERMINAL_READER_KEY) === "on";
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(on: boolean): void {
    this.value = on;
    this.storage.setItem(TERMINAL_READER_KEY, on ? "on" : "off");
    for (const listener of this.listeners) listener();
  }
}
