import { describe, expect, test } from "bun:test";
import { FIND_DECORATIONS } from "../src/lib/terminal-view.ts";
import {
  createXtermScreen,
  type XtermDeps,
  type XtermLink,
  type XtermLinkProvider,
  type XtermSearch,
  type XtermTerminal,
} from "../src/lib/xterm-screen.ts";

const THEME = {
  background: "#000000",
  foreground: "#ffffff",
  cursor: "#ffffff",
  selectionBackground: "#333333",
};

/** Characters a terminal draws two cells wide, as xterm does: the second cell is empty, width 0. */
const WIDE = new Set(["⏺", "界"]);

/** A row as xterm keeps it: one cell per narrow character, two for a wide one. */
function cellsOf(text: string) {
  const cells: Array<{ getChars(): string; getWidth(): number }> = [];
  for (const char of text) {
    cells.push({ getChars: () => char, getWidth: () => (WIDE.has(char) ? 2 : 1) });
    if (WIDE.has(char)) cells.push({ getChars: () => "", getWidth: () => 0 });
  }
  return {
    length: cells.length,
    getCell: (x: number) => cells[x],
    translateToString: () => text,
  };
}

function setup(initial = "", clipboardFails = false, windows = false) {
  let selection = initial;
  let onSelection: () => void = () => {};
  const log: string[] = [];
  const clip: string[] = [];
  const inputs: string[] = [];
  const resizes: Array<[number, number]> = [];
  let searches = 0;
  let onData: (data: string) => void = () => {};
  let onResize: (size: { cols: number; rows: number }) => void = () => {};
  let keyHandler: (event: KeyboardEvent) => boolean = () => true;
  let linkProvider: XtermLinkProvider | null = null;
  const lines: string[] = [];
  const paths: Array<[string, unknown]> = [];
  let wheelHandler: (event: WheelEvent) => boolean = () => true;
  const zooms: string[] = [];
  const addons: unknown[] = [];
  const callbacks: Array<() => void> = [];
  const links: Array<(uri: string) => void> = [];
  const linked: string[] = [];
  let constructed: Record<string, unknown> = {};
  const terminal: XtermTerminal = {
    cols: 80,
    rows: 24,
    options: {},
    unicode: { activeVersion: "6" },
    loadAddon: (addon) => void addons.push(addon),
    open: () => void log.push("open"),
    write: (bytes, callback) => {
      log.push(`write:${Buffer.from(bytes).toString()}`);
      if (callback) callbacks.push(callback);
    },
    reset: () => void log.push("reset"),
    focus: () => void log.push("focus"),
    selectAll: () => void log.push("select-all"),
    paste: (text) => void log.push(`paste:${text}`),
    hasSelection: () => selection !== "",
    getSelection: () => selection,
    onSelectionChange: (listener) => {
      onSelection = listener;
      return { dispose: () => void log.push("off-selection") };
    },
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
    attachCustomWheelEventHandler: (handler) => {
      wheelHandler = handler;
    },
    registerLinkProvider: (provider) => {
      linkProvider = provider;
      return { dispose: () => void log.push("off-paths") };
    },
    buffer: {
      active: {
        getLine: (y) => {
          const text = lines[y];
          return text === undefined ? undefined : cellsOf(text);
        },
      },
    },
    dispose: () => void log.push("dispose"),
  };
  const findOptions: unknown[] = [];
  const found: Array<{ resultIndex: number; resultCount: number }> = [];
  let announce: (results: { resultIndex: number; resultCount: number }) => void = () => {};
  const search: XtermSearch = {
    findNext: (text, options) => {
      log.push(`next:${text}`);
      findOptions.push(options);
      return text === "hit";
    },
    findPrevious: (text, options) => {
      log.push(`prev:${text}`);
      findOptions.push(options);
      return true;
    },
    clearDecorations: () => void log.push("clear"),
    onDidChangeResults: (listener) => {
      announce = listener;
      return { dispose: () => void searchOff.push(1) };
    },
  };
  const searchOff: number[] = [];
  const fit = { fit: () => void log.push("fit") };
  const deps: XtermDeps = {
    terminal: (options) => {
      constructed = options;
      return terminal;
    },
    fit: () => fit,
    webLinks: (open) => {
      links.push(open);
      return { kind: "links" };
    },
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
    windows,
    onInput: (data) => void inputs.push(data),
    onResize: (cols, rows) => void resizes.push([cols, rows]),
    onSearch: () => void searches++,
    onFindResults: (results) => void found.push(results),
    onLink: (uri) => void linked.push(uri),
    onPath: (path, at) => void paths.push([path, at]),
    onZoom: (step) => void zooms.push(step),
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
    links,
    linked,
    log,
    clip,
    inputs,
    resizes,
    addons,
    terminal,
    drawAll: () => {
      for (const callback of callbacks.splice(0)) callback();
    },
    press,
    keys: (event: KeyboardEvent) => keyHandler(event),
    paths,
    /** The output's rows, from the top of the buffer. */
    showLines: (...rows: string[]) => void lines.splice(0, lines.length, ...rows),
    /** The links xterm would ask for on a row (1-based, as xterm counts). */
    linksOn: (y: number) =>
      new Promise<XtermLink[] | undefined>((resolve) => {
        if (!linkProvider) resolve(undefined);
        else linkProvider.provideLinks(y, resolve);
      }),
    wheel: (event: WheelEvent) => wheelHandler(event),
    zooms,
    constructed: () => constructed,
    searches: () => searches,
    findOptions,
    found,
    announce: (resultIndex: number, resultCount: number) => announce({ resultIndex, resultCount }),
    searchOff,
    typed: (data: string) => onData(data),
    /** The person selects: xterm has the text and says it changed. */
    select: (text: string) => {
      selection = text;
      onSelection();
    },
    /** The program redraws the selected rows: xterm drops the selection and says it changed. */
    lose: () => {
      selection = "";
      onSelection();
    },
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

  // Issue #476: xterm's default of 1,000 lines lost the start of a long Claude turn from the view
  // and from find, though the daemon still had it. Windows Terminal keeps 9,001.
  test("the view keeps 10,000 lines of scrollback", () => {
    expect(setup().constructed().scrollback).toBe(10_000);
  });

  test("output and resets go to xterm; opening fits it and gives it the focus", () => {
    const s = setup();
    s.screen.write(new TextEncoder().encode("hi"));
    s.screen.reset();
    s.screen.open({} as HTMLElement);
    s.screen.focus();
    expect(s.log).toEqual(["write:hi", "reset", "open", "fit", "focus"]);
  });

  test("a write is reported as drawn when xterm's own callback runs, not before", () => {
    const s = setup();
    let drawn = 0;
    s.screen.write(new TextEncoder().encode("hi"), () => void drawn++);
    expect(drawn).toBe(0);
    s.drawAll();
    expect(drawn).toBe(1);
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

  test("a selection the program's redraw took away can still be copied: the last one is kept until the person types", async () => {
    const s = setup();
    s.select("abc");
    s.lose();
    expect(s.screen.hasSelection()).toBe(true);
    s.screen.copy();
    await Promise.resolve();
    expect(s.clip).toEqual(["copy:abc"]);
    expect(s.press("C")).toBe(false);
    await Promise.resolve();
    expect(s.clip).toEqual(["copy:abc", "copy:abc"]);
    s.typed("l");
    expect(s.screen.hasSelection()).toBe(false);
    s.screen.copy();
    await Promise.resolve();
    expect(s.clip).toHaveLength(2);
    expect(s.inputs).toEqual(["l"]);
  });

  test("a new selection replaces the kept one, and the live one wins over it", async () => {
    const s = setup();
    s.select("old");
    s.select("new");
    s.lose();
    s.screen.copy();
    await Promise.resolve();
    expect(s.clip).toEqual(["copy:new"]);
    s.select("live");
    s.screen.copy();
    await Promise.resolve();
    expect(s.clip).toEqual(["copy:new", "copy:live"]);
  });

  test("on Windows Ctrl+C copies when there is a selection and goes to the process (SIGINT) when there is none", async () => {
    const withSelection = setup("abc", false, true);
    expect(withSelection.press("c", true, false)).toBe(false);
    await Promise.resolve();
    expect(withSelection.clip).toEqual(["copy:abc"]);
    const without = setup("", false, true);
    expect(without.press("c", true, false)).toBe(true);
    await Promise.resolve();
    expect(without.clip).toEqual([]);
  });

  test("off Windows Ctrl+C always goes to the process, even over a selection", async () => {
    const s = setup("abc", false, false);
    expect(s.press("c", true, false)).toBe(true);
    await Promise.resolve();
    expect(s.clip).toEqual([]);
  });

  test("Shift+Enter alone sends the newline Claude Code reads (ESC then CR) once, and plain Enter is left to xterm", () => {
    const s = setup();
    const key = (type: string, over: Partial<KeyboardEvent> = {}) =>
      ({
        key: "Enter",
        type,
        ctrlKey: false,
        shiftKey: true,
        altKey: false,
        metaKey: false,
        ...over,
      }) as KeyboardEvent;
    // xterm asks about keydown, keypress and keyup: only the keydown sends, and none of them reaches xterm's own CR.
    expect(s.keys(key("keydown"))).toBe(false);
    expect(s.keys(key("keypress"))).toBe(false);
    expect(s.keys(key("keyup"))).toBe(false);
    expect(s.inputs).toEqual(["\u001b\r"]);
    // Enter alone, and Shift+Enter with another modifier, are not this.
    expect(s.keys(key("keydown", { shiftKey: false }))).toBe(true);
    expect(s.keys(key("keydown", { ctrlKey: true }))).toBe(true);
    expect(s.keys(key("keydown", { altKey: true }))).toBe(true);
    expect(s.keys(key("keydown", { metaKey: true }))).toBe(true);
    expect(s.inputs).toEqual(["\u001b\r"]);
  });

  test("Ctrl+=, Ctrl+- and Ctrl+0 zoom once per press, kept from the process and from the page's own zoom (issue #476)", () => {
    const s = setup();
    let prevented = 0;
    const key = (k: string, type = "keydown") =>
      ({
        key: k,
        type,
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        preventDefault: () => void prevented++,
      }) as unknown as KeyboardEvent;
    expect(s.keys(key("="))).toBe(false);
    expect(s.keys(key("=", "keyup"))).toBe(false);
    expect(s.keys(key("-"))).toBe(false);
    expect(s.keys(key("0"))).toBe(false);
    expect([s.zooms, prevented, s.inputs]).toEqual([["zoomIn", "zoomOut", "zoomReset"], 4, []]);
  });

  test("Ctrl+wheel zooms and keeps the page from zooming; the wheel alone stays xterm's scroll (issue #476)", () => {
    const s = setup();
    let prevented = 0;
    const wheel = (ctrlKey: boolean, deltaY: number) =>
      ({ ctrlKey, deltaY, preventDefault: () => void prevented++ }) as unknown as WheelEvent;
    expect(s.wheel(wheel(true, -100))).toBe(false);
    expect(s.wheel(wheel(true, 100))).toBe(false);
    expect(s.wheel(wheel(false, 100))).toBe(true);
    expect([s.zooms, prevented]).toEqual([["zoomIn", "zoomOut"], 2]);
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

  test("a file path in the output is a link over its own cells; clicking it hands the path on (issue #476)", async () => {
    const s = setup();
    s.showLines("nothing here", "see src/a.ts:3 now");
    expect(await s.linksOn(1)).toBeUndefined();
    const links = await s.linksOn(2);
    expect(links?.map((link) => [link.text, link.range])).toEqual([
      ["src/a.ts:3", { start: { x: 5, y: 2 }, end: { x: 14, y: 2 } }],
    ]);
    links?.[0]?.activate({} as MouseEvent, "src/a.ts:3");
    expect(s.paths).toEqual([["src/a.ts", { line: 3 }]]);
  });

  test("a path printed without a line hands on no position (#506)", async () => {
    const s = setup();
    s.showLines("wrote ./notes/b.md:4:2 and /x/y.md");
    for (const link of (await s.linksOn(1)) ?? []) link.activate({} as MouseEvent, link.text);
    expect(s.paths).toEqual([
      ["./notes/b.md", { line: 4, col: 2 }],
      ["/x/y.md", undefined],
    ]);
  });

  test("on a row with wide characters the link still sits over the path's own cells (issue #476)", async () => {
    const s = setup();
    s.showLines("⏺ src/a.ts");
    const links = await s.linksOn(1);
    expect(links?.map((link) => link.range)).toEqual([
      { start: { x: 4, y: 1 }, end: { x: 11, y: 1 } },
    ]);
  });

  test("screen reader mode is given to xterm at the start and follows the setting (issue #476)", () => {
    const s = setup();
    expect(s.constructed().screenReaderMode).toBe(false);
    s.screen.setScreenReader(true);
    expect(s.terminal.options.screenReaderMode).toBe(true);
    s.screen.setScreenReader(false);
    expect(s.terminal.options.screenReaderMode).toBe(false);
  });

  test("dispose releases the listeners and xterm", () => {
    const s = setup();
    s.screen.dispose();
    expect(s.log).toEqual(["off-selection", "off-data", "off-resize", "off-paths", "dispose"]);
  });

  test("a clipboard that refuses to copy or to be read leaves the terminal as it was", async () => {
    const s = setup("abc", true);
    expect(s.press("C")).toBe(false);
    expect(s.press("V")).toBe(false);
    await Bun.sleep(5);
    expect(s.log).toEqual([]);
  });

  test("copy and paste are there for a menu too, and a clicked link goes to onLink", async () => {
    const s = setup("sel");
    s.screen.copy();
    s.screen.paste();
    await Promise.resolve();
    await Promise.resolve();
    expect(s.clip).toEqual(["copy:sel"]);
    expect(s.log).toContain("paste:pasted");
    s.links[0]?.("https://example.com");
    expect(s.linked).toEqual(["https://example.com"]);
  });

  test("find highlights every match and marks the current one; typing keeps the match", () => {
    const s = setup();
    s.screen.find("hit", "next");
    s.screen.find("hit", "previous");
    s.screen.find("hi", "next", true);
    expect(s.findOptions).toEqual([
      { incremental: false, decorations: FIND_DECORATIONS },
      { incremental: false, decorations: FIND_DECORATIONS },
      { incremental: true, decorations: FIND_DECORATIONS },
    ]);
    const colors = Object.values(FIND_DECORATIONS);
    expect(colors.every((color) => /^#[0-9a-f]{6}$/i.test(color))).toBe(true);
    expect(FIND_DECORATIONS.matchBackground).toBeDefined();
    expect(FIND_DECORATIONS.activeMatchBackground).toBeDefined();
    expect(FIND_DECORATIONS.activeMatchBackground).not.toBe(FIND_DECORATIONS.matchBackground);
  });

  test("the position among the matches is reported, and its listener is released on dispose", () => {
    const s = setup();
    s.announce(1, 5);
    expect(s.found).toEqual([{ resultIndex: 1, resultCount: 5 }]);
    s.screen.dispose();
    expect(s.searchOff).toEqual([1]);
  });

  test("select all and the selection state are there for the menu", () => {
    const s = setup("abc");
    expect(s.screen.hasSelection()).toBe(true);
    s.screen.selectAll();
    expect(s.log).toContain("select-all");
    expect(setup().screen.hasSelection()).toBe(false);
  });
});
