import type { Platform } from "../../platform/types.ts";
import { clampFont, TERMINAL_FONT_DEFAULT, type TerminalZoom } from "./domain/terminal-view.ts";

export const TERMINAL_FONT_KEY = "flightdeck.terminal-font";

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
