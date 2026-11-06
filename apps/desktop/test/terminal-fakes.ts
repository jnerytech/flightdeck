import type { XtermDeps, XtermTerminal } from "../src/lib/xterm-screen.ts";

/** An xterm the tests drive: what it was given to draw, and the hands to type and press keys. */
export function fakeXterm() {
  const drawn: string[] = [];
  const finds: string[] = [];
  const findOptions: Array<Record<string, unknown> | undefined> = [];
  let onResults: (results: { resultIndex: number; resultCount: number }) => void = () => {};
  let selectedAll = 0;
  let onData: (data: string) => void = () => {};
  let onResize: (size: { cols: number; rows: number }) => void = () => {};
  let keyHandler: (event: KeyboardEvent) => boolean = () => true;
  let wheelHandler: (event: WheelEvent) => boolean = () => true;
  let disposed = false;
  let openLink: (uri: string) => void = () => {};
  let selection = "";
  let fits = 0;
  const pasted: string[] = [];
  let fonts: number[] = [];
  const terminal: XtermTerminal = {
    cols: 80,
    rows: 24,
    options: {},
    unicode: { activeVersion: "6" },
    modes: { bracketedPasteMode: false },
    loadAddon: () => {},
    open: () => {},
    write: (bytes) => void drawn.push(Buffer.from(bytes).toString()),
    reset: () => void drawn.push("<reset>"),
    focus: () => {},
    paste: (text) => void pasted.push(text),
    selectAll: () => {
      selectedAll++;
    },
    hasSelection: () => selection !== "",
    getSelection: () => selection,
    onSelectionChange: () => ({ dispose: () => {} }),
    onData: (listener) => {
      onData = listener;
      return { dispose: () => {} };
    },
    onResize: (listener) => {
      onResize = listener;
      return { dispose: () => {} };
    },
    attachCustomKeyEventHandler: (handler) => {
      keyHandler = handler;
    },
    attachCustomWheelEventHandler: (handler) => {
      wheelHandler = handler;
    },
    dispose: () => {
      disposed = true;
    },
  };
  const deps: XtermDeps = {
    terminal: (options) => {
      fonts = [options.fontSize as number];
      return terminal;
    },
    fit: () => ({
      fit: () => {
        fits++;
      },
    }),
    webLinks: (open) => {
      openLink = open;
      return {};
    },
    search: () => ({
      findNext: (text, options) => {
        finds.push(`next:${text}`);
        findOptions.push(options as Record<string, unknown> | undefined);
        return true;
      },
      findPrevious: (text, options) => {
        finds.push(`prev:${text}`);
        findOptions.push(options as Record<string, unknown> | undefined);
        return true;
      },
      clearDecorations: () => void finds.push("clear"),
      onDidChangeResults: (listener) => {
        onResults = listener;
        return { dispose: () => {} };
      },
    }),
    unicode11: () => ({}),
  };
  return {
    deps,
    drawn,
    finds,
    findOptions,
    foundResults: (resultIndex: number, resultCount: number) =>
      onResults({ resultIndex, resultCount }),
    selectedAll: () => selectedAll,
    terminal,
    fonts: () => fonts,
    disposed: () => disposed,
    pasted,
    clickLink: (uri: string) => openLink(uri),
    fits: () => fits,
    select: (text: string) => {
      selection = text;
    },
    type: (data: string) => onData(data),
    resize: (cols: number, rows: number) => onResize({ cols, rows }),
    chord: (key: string) =>
      keyHandler({
        key,
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
        metaKey: false,
      } as KeyboardEvent),
    /** Ctrl and a key, without Shift, as the zoom keys are pressed. */
    ctrlKey: (key: string) =>
      keyHandler({
        key,
        type: "keydown",
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        preventDefault: () => {},
      } as unknown as KeyboardEvent),
    /** The wheel turned with Ctrl held: negative is up. */
    ctrlWheel: (deltaY: number) =>
      wheelHandler({ ctrlKey: true, deltaY, preventDefault: () => {} } as unknown as WheelEvent),
  };
}
