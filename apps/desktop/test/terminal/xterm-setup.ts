import {
  createXtermScreen,
  type XtermDeps,
  type XtermLink,
  type XtermLinkProvider,
  type XtermSearch,
  type XtermTerminal,
} from "../../src/features/terminal/xterm-screen.ts";

export const THEME = {
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

export function setup(
  initial = "",
  clipboardFails = false,
  windows = false,
  more: { clip?: string; bracketed?: boolean; confirm?: (text: string) => Promise<boolean> } = {},
) {
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
    modes: { bracketedPasteMode: more.bracketed ?? false },
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
        return more.clip ?? "pasted";
      },
    },
    ...(more.confirm ? { confirmPaste: more.confirm } : {}),
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
