import type { Platform } from "../platform/types.ts";
import type { Theme } from "./theme.ts";

export type TerminalKeyAction = "copy" | "paste" | "search" | "snippets" | "pass";

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

/** Ctrl+Shift+C/V/F/Space are the app's; everything else, Ctrl+C included, goes to the process. */
export function terminalKeyAction(event: TerminalKey): TerminalKeyAction {
  if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return "pass";
  return KEY_ACTIONS[event.key.toLowerCase()] ?? "pass";
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
}
