import { describe, expect, test } from "bun:test";
import { createXtermScreen, type XtermDeps, type XtermTerminal } from "../src/lib/xterm-screen.ts";

const THEME = {
  background: "#000000",
  foreground: "#ffffff",
  cursor: "#ffffff",
  selectionBackground: "#333333",
};

function setup(selection = "", clipboardFails = false) {
  const log: string[] = [];
  const clip: string[] = [];
  const inputs: string[] = [];
  const resizes: Array<[number, number]> = [];
  let searches = 0;
  let onData: (data: string) => void = () => {};
  let onResize: (size: { cols: number; rows: number }) => void = () => {};
  let keyHandler: (event: KeyboardEvent) => boolean = () => true;
  const addons: unknown[] = [];
  let constructed: Record<string, unknown> = {};
  const terminal: XtermTerminal = {
    cols: 80,
    rows: 24,
    options: {},
    unicode: { activeVersion: "6" },
    loadAddon: (addon) => void addons.push(addon),
    open: () => void log.push("open"),
    write: (bytes) => void log.push(`write:${Buffer.from(bytes).toString()}`),
    reset: () => void log.push("reset"),
    focus: () => void log.push("focus"),
    paste: (text) => void log.push(`paste:${text}`),
    hasSelection: () => selection !== "",
    getSelection: () => selection,
    onData: (listener) => {
      onData = listener;
      return { dispose: () => void log.push("off-data") };
    },
    onResize: (listener) => {
      onResize = listener;
      return { dispose: () => void log.push("off-resize") };
    },
    attachCustomKeyEventHandler: (handler) => {
      keyHandler = handler;
    },
    dispose: () => void log.push("dispose"),
  };
  const search = {
    findNext: (text: string) => {
      log.push(`next:${text}`);
      return text === "hit";
    },
    findPrevious: (text: string) => {
      log.push(`prev:${text}`);
      return true;
    },
    clearDecorations: () => void log.push("clear"),
  };
  const fit = { fit: () => void log.push("fit") };
  const deps: XtermDeps = {
    terminal: (options) => {
      constructed = options;
      return terminal;
    },
    fit: () => fit,
    webLinks: () => ({ kind: "links" }),
    search: () => search,
    unicode11: () => ({ kind: "unicode" }),
  };
  const screen = createXtermScreen(deps, {
    theme: THEME,
    fontSize: 13,
    fontFamily: "mono",
    clipboard: {
      copy: async (text) => {
        if (clipboardFails) throw new Error("denied");
        clip.push(`copy:${text}`);
      },
      read: async () => {
        if (clipboardFails) throw new Error("denied");
        return "pasted";
      },
    },
    onInput: (data) => void inputs.push(data),
    onResize: (cols, rows) => void resizes.push([cols, rows]),
    onSearch: () => void searches++,
  });
  const press = (key: string, ctrl = true, shift = true) =>
    keyHandler({
      key,
      ctrlKey: ctrl,
      shiftKey: shift,
      altKey: false,
      metaKey: false,
    } as KeyboardEvent);
  return {
    screen,
    log,
    clip,
    inputs,
    resizes,
    addons,
    terminal,
    press,
    constructed: () => constructed,
    searches: () => searches,
    typed: (data: string) => onData(data),
    resized: (cols: number, rows: number) => onResize({ cols, rows }),
  };
}

describe("terminal-ui: the xterm screen", () => {
  test("xterm is built with the theme, font and the four addons, with unicode 11 on", () => {
    const s = setup();
    expect(s.constructed()).toMatchObject({
      theme: THEME,
      fontSize: 13,
      fontFamily: "mono",
      cursorBlink: true,
      allowProposedApi: true,
    });
    expect(s.addons).toHaveLength(4);
    expect(s.terminal.unicode.activeVersion).toBe("11");
  });

  test("output and resets go to xterm; opening fits it and gives it the focus", () => {
    const s = setup();
    s.screen.write(new TextEncoder().encode("hi"));
    s.screen.reset();
    s.screen.open({} as HTMLElement);
    s.screen.focus();
    expect(s.log).toEqual(["write:hi", "reset", "open", "fit", "focus"]);
  });

  test("keys typed and sizes changed are reported", () => {
    const s = setup();
    s.typed("ls\r");
    s.resized(100, 30);
    expect(s.inputs).toEqual(["ls\r"]);
    expect(s.resizes).toEqual([[100, 30]]);
  });

  test("Ctrl+Shift+C copies the selection and is kept from the process; with no selection it does nothing", async () => {
    const withSelection = setup("abc");
    expect(withSelection.press("C")).toBe(false);
    await Promise.resolve();
    expect(withSelection.clip).toEqual(["copy:abc"]);
    const without = setup("");
    expect(without.press("C")).toBe(false);
    await Promise.resolve();
    expect(without.clip).toEqual([]);
  });

  test("Ctrl+Shift+V pastes the clipboard through xterm; Ctrl+Shift+F asks for the search; the rest passes", async () => {
    const s = setup();
    expect(s.press("V")).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(s.log).toContain("paste:pasted");
    expect(s.press("F")).toBe(false);
    expect(s.searches()).toBe(1);
    expect(s.press("c", true, false)).toBe(true);
    expect(s.press("a", false, false)).toBe(true);
  });

  test("theme and font changes apply and refit; find goes next or previous and clears", () => {
    const s = setup();
    s.screen.setTheme({ ...THEME, background: "#ffffff" });
    s.screen.setFontSize(16);
    expect(s.terminal.options.theme?.background).toBe("#ffffff");
    expect(s.terminal.options.fontSize).toBe(16);
    expect(s.log.filter((entry) => entry === "fit")).toHaveLength(1);
    expect(s.screen.find("hit", "next")).toBe(true);
    expect(s.screen.find("miss", "next")).toBe(false);
    expect(s.screen.find("x", "previous")).toBe(true);
    s.screen.clearFind();
    expect(s.log.slice(-4)).toEqual(["next:hit", "next:miss", "prev:x", "clear"]);
  });

  test("dispose releases the listeners and xterm", () => {
    const s = setup();
    s.screen.dispose();
    expect(s.log).toEqual(["off-data", "off-resize", "dispose"]);
  });

  test("a clipboard that refuses to copy or to be read leaves the terminal as it was", async () => {
    const s = setup("abc", true);
    expect(s.press("C")).toBe(false);
    expect(s.press("V")).toBe(false);
    await Bun.sleep(5);
    expect(s.log).toEqual([]);
  });
});
