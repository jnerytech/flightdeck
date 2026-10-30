import type { XtermDeps, XtermTerminal } from "../src/lib/xterm-screen.ts";

/** An xterm the tests drive: what it was given to draw, and the hands to type and press keys. */
export function fakeXterm() {
  const drawn: string[] = [];
  const finds: string[] = [];
  let onData: (data: string) => void = () => {};
  let onResize: (size: { cols: number; rows: number }) => void = () => {};
  let keyHandler: (event: KeyboardEvent) => boolean = () => true;
  let disposed = false;
  let fonts: number[] = [];
  const terminal: XtermTerminal = {
    cols: 80,
    rows: 24,
    options: {},
    unicode: { activeVersion: "6" },
    loadAddon: () => {},
    open: () => {},
    write: (bytes) => void drawn.push(Buffer.from(bytes).toString()),
    reset: () => void drawn.push("<reset>"),
    focus: () => {},
    paste: () => {},
    hasSelection: () => false,
    getSelection: () => "",
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
    dispose: () => {
      disposed = true;
    },
  };
  const deps: XtermDeps = {
    terminal: (options) => {
      fonts = [options.fontSize as number];
      return terminal;
    },
    fit: () => ({ fit: () => {} }),
    webLinks: () => ({}),
    search: () => ({
      findNext: (text) => {
        finds.push(`next:${text}`);
        return true;
      },
      findPrevious: (text) => {
        finds.push(`prev:${text}`);
        return true;
      },
      clearDecorations: () => void finds.push("clear"),
    }),
    unicode11: () => ({}),
  };
  return {
    deps,
    drawn,
    finds,
    terminal,
    fonts: () => fonts,
    disposed: () => disposed,
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
  };
}
