import { describe, expect, test } from "bun:test";
import {
  findPatternProblem,
  isWindowsHost,
  TERMINAL_FONT_DEFAULT,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_KEY,
  TERMINAL_FONT_MAX,
  TERMINAL_FONT_MIN,
  TERMINAL_READER_KEY,
  TerminalFontController,
  TerminalReaderSetting,
  terminalKeyAction,
  terminalTheme,
  terminalWheelAction,
} from "../src/lib/terminal-view.ts";

const key = (
  k: string,
  mods: Partial<Record<"ctrl" | "shift" | "alt" | "meta", boolean>> = {},
) => ({
  key: k,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
  metaKey: mods.meta ?? false,
});

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    storage: {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    },
  };
}

describe("terminal-ui: keys, colors and font", () => {
  test("Ctrl+Shift+C, V and F are the app's, in either case; Ctrl+C and the rest go to the process", () => {
    expect(terminalKeyAction(key("C", { ctrl: true, shift: true }))).toBe("copy");
    expect(terminalKeyAction(key("c", { ctrl: true, shift: true }))).toBe("copy");
    expect(terminalKeyAction(key("V", { ctrl: true, shift: true }))).toBe("paste");
    expect(terminalKeyAction(key("F", { ctrl: true, shift: true }))).toBe("search");
    expect(terminalKeyAction(key("c", { ctrl: true }))).toBe("pass");
    // Shift+Enter alone is a new line; with another modifier, or Enter alone, it is not.
    expect(terminalKeyAction(key("Enter", { shift: true }))).toBe("newline");
    expect(terminalKeyAction(key("Enter", {}))).toBe("pass");
    expect(terminalKeyAction(key("Enter", { shift: true, ctrl: true }))).toBe("pass");
    expect(terminalKeyAction(key("Enter", { shift: true, alt: true }))).toBe("pass");
    // Ctrl+C is the interrupt; on Windows it copies only while something is selected.
    expect(terminalKeyAction(key("c", { ctrl: true }), { windows: true, selected: true })).toBe(
      "copy",
    );
    expect(terminalKeyAction(key("c", { ctrl: true }), { windows: true, selected: false })).toBe(
      "pass",
    );
    expect(terminalKeyAction(key("c", { ctrl: true }), { windows: false, selected: true })).toBe(
      "pass",
    );
    expect(terminalKeyAction(key("v", { ctrl: true }), { windows: true, selected: true })).toBe(
      "pass",
    );
    expect(terminalKeyAction(key("c", {}), { windows: true, selected: true })).toBe("pass");
    expect(terminalKeyAction(key("v", { ctrl: true }))).toBe("pass");
    expect(terminalKeyAction(key("C", { ctrl: true, shift: true, alt: true }))).toBe("pass");
    expect(terminalKeyAction(key("C", { shift: true }))).toBe("pass");
    expect(terminalKeyAction(key("x", { ctrl: true, shift: true }))).toBe("pass");
  });

  test("each theme has its own sRGB colors", () => {
    const light = terminalTheme("light");
    const dark = terminalTheme("dark");
    for (const colors of [light, dark]) {
      for (const value of Object.values(colors)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(light.background).not.toBe(dark.background);
    expect(light.foreground).not.toBe(light.background);
    expect(dark.foreground).not.toBe(dark.background);
  });

  test("the font is monospace with Cascadia Mono and Consolas first", () => {
    expect(TERMINAL_FONT_FAMILY).toBe('"Cascadia Mono", Consolas, monospace');
  });

  test("the font size starts at 13, is kept and is clamped to 10..24", () => {
    expect([TERMINAL_FONT_DEFAULT, TERMINAL_FONT_MIN, TERMINAL_FONT_MAX]).toEqual([13, 10, 24]);
    const fresh = memoryStorage();
    const controller = new TerminalFontController(fresh.storage);
    expect(controller.value).toBe(13);
    let notified = 0;
    controller.subscribe(() => notified++);
    controller.set(16);
    expect(controller.value).toBe(16);
    expect(fresh.items.get(TERMINAL_FONT_KEY)).toBe("16");
    controller.set(99);
    expect(controller.value).toBe(24);
    controller.set(2);
    expect(controller.value).toBe(10);
    controller.set(14.4);
    expect(controller.value).toBe(14);
    expect(notified).toBe(4);
    expect(
      new TerminalFontController(memoryStorage({ [TERMINAL_FONT_KEY]: "18" }).storage).value,
    ).toBe(18);
    expect(
      new TerminalFontController(memoryStorage({ [TERMINAL_FONT_KEY]: "abc" }).storage).value,
    ).toBe(13);
    expect(
      new TerminalFontController(memoryStorage({ [TERMINAL_FONT_KEY]: "400" }).storage).value,
    ).toBe(24);
  });

  test("Ctrl with =, +, - or 0 zooms the terminal, with Shift or not, and only with Ctrl alone (issue #476)", () => {
    expect(terminalKeyAction(key("=", { ctrl: true }))).toBe("zoomIn");
    expect(terminalKeyAction(key("+", { ctrl: true, shift: true }))).toBe("zoomIn");
    expect(terminalKeyAction(key("-", { ctrl: true }))).toBe("zoomOut");
    expect(terminalKeyAction(key("_", { ctrl: true, shift: true }))).toBe("zoomOut");
    expect(terminalKeyAction(key("0", { ctrl: true }))).toBe("zoomReset");
    expect(terminalKeyAction(key("="))).toBe("pass");
    expect(terminalKeyAction(key("-", { ctrl: true, alt: true }))).toBe("pass");
    expect(terminalKeyAction(key("0", { ctrl: true, meta: true }))).toBe("pass");
  });

  test("Ctrl+wheel zooms, up in and down out; the wheel alone is left to scroll (issue #476)", () => {
    expect(terminalWheelAction({ ctrlKey: true, deltaY: -120 })).toBe("zoomIn");
    expect(terminalWheelAction({ ctrlKey: true, deltaY: 120 })).toBe("zoomOut");
    expect(terminalWheelAction({ ctrlKey: true, deltaY: 0 })).toBeNull();
    expect(terminalWheelAction({ ctrlKey: false, deltaY: -120 })).toBeNull();
  });

  test("a zoom step moves the kept font size by 1 within 10..24, and the reset brings back 13 (issue #476)", () => {
    const kept = memoryStorage({ [TERMINAL_FONT_KEY]: "23" });
    const controller = new TerminalFontController(kept.storage);
    const sizes: number[] = [];
    for (const step of ["zoomIn", "zoomIn", "zoomOut", "zoomReset"] as const) {
      controller.zoom(step);
      sizes.push(controller.value);
    }
    expect(sizes).toEqual([24, 24, 23, 13]);
    expect(kept.items.get(TERMINAL_FONT_KEY)).toBe("13");
    const smallest = new TerminalFontController(
      memoryStorage({ [TERMINAL_FONT_KEY]: "10" }).storage,
    );
    smallest.zoom("zoomOut");
    expect(smallest.value).toBe(10);
  });

  test("screen reader support is off at first, then kept as it was set (issue #476)", () => {
    const fresh = memoryStorage();
    const setting = new TerminalReaderSetting(fresh.storage);
    expect(setting.value).toBe(false);
    let told = 0;
    setting.subscribe(() => told++);
    setting.set(true);
    expect([setting.value, fresh.items.get(TERMINAL_READER_KEY), told]).toEqual([true, "on", 1]);
    setting.set(false);
    expect(fresh.items.get(TERMINAL_READER_KEY)).toBe("off");
    const kept = memoryStorage({ [TERMINAL_READER_KEY]: "on" });
    expect(new TerminalReaderSetting(kept.storage).value).toBe(true);
  });

  test("a regular expression that cannot be read, or that matches empty text, is not searched (issue #476)", () => {
    expect(findPatternProblem("a(", { regex: true })).toBe("invalid");
    expect(findPatternProblem("a*", { regex: true })).toBe("empty");
    expect(findPatternProblem("a+", { regex: true })).toBeNull();
    expect(findPatternProblem("a(", {})).toBeNull();
  });

  test("the host is Windows when the user agent says so", () => {
    expect(
      isWindowsHost("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/130"),
    ).toBe(true);
    expect(isWindowsHost("Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36")).toBe(false);
    expect(isWindowsHost("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(false);
  });
});
