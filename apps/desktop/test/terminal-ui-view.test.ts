import { describe, expect, test } from "bun:test";
import {
  isWindowsHost,
  TERMINAL_FONT_DEFAULT,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_KEY,
  TERMINAL_FONT_MAX,
  TERMINAL_FONT_MIN,
  TerminalFontController,
  terminalKeyAction,
  terminalTheme,
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

  test("the host is Windows when the user agent says so", () => {
    expect(
      isWindowsHost("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/130"),
    ).toBe(true);
    expect(isWindowsHost("Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36")).toBe(false);
    expect(isWindowsHost("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(false);
  });
});
