import { type TerminalColors, terminalKeyAction } from "./terminal-view.ts";

/** The slice of xterm's Terminal the app uses; a fake stands in for it in the tests. */
export interface XtermTerminal {
  cols: number;
  rows: number;
  options: { theme?: TerminalColors; fontSize?: number; fontFamily?: string };
  unicode: { activeVersion: string };
  loadAddon(addon: unknown): void;
  open(parent: HTMLElement): void;
  write(data: Uint8Array): void;
  reset(): void;
  focus(): void;
  paste(text: string): void;
  hasSelection(): boolean;
  getSelection(): string;
  onData(listener: (data: string) => void): { dispose(): void };
  onResize(listener: (size: { cols: number; rows: number }) => void): { dispose(): void };
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void;
  dispose(): void;
}

export interface XtermSearch {
  findNext(text: string): boolean;
  findPrevious(text: string): boolean;
  clearDecorations(): void;
}

/** Builds the xterm pieces; the real ones come from `xterm-deps.ts`, fakes from the tests. */
export interface XtermDeps {
  terminal(options: Record<string, unknown>): XtermTerminal;
  fit(): { fit(): void };
  webLinks(): unknown;
  search(): XtermSearch;
  unicode11(): unknown;
}

export interface XtermScreenOptions {
  theme: TerminalColors;
  fontSize: number;
  fontFamily: string;
  clipboard: { copy(text: string): Promise<void>; read(): Promise<string> };
  onInput(data: string): void;
  onResize(cols: number, rows: number): void;
  onSearch(): void;
}

export interface XtermScreen {
  write(bytes: Uint8Array): void;
  reset(): void;
  open(parent: HTMLElement): void;
  fit(): void;
  setTheme(theme: TerminalColors): void;
  setFontSize(size: number): void;
  find(text: string, direction: "next" | "previous"): boolean;
  clearFind(): void;
  focus(): void;
  dispose(): void;
}

export function createXtermScreen(deps: XtermDeps, options: XtermScreenOptions): XtermScreen {
  const terminal = deps.terminal({
    theme: options.theme,
    fontSize: options.fontSize,
    fontFamily: options.fontFamily,
    cursorBlink: true,
  });
  const fit = deps.fit();
  const search = deps.search();
  for (const addon of [fit, deps.webLinks(), search, deps.unicode11()]) terminal.loadAddon(addon);
  terminal.unicode.activeVersion = "11";

  const input = terminal.onData(options.onInput);
  const size = terminal.onResize(({ cols, rows }) => options.onResize(cols, rows));
  terminal.attachCustomKeyEventHandler((event) => {
    switch (terminalKeyAction(event)) {
      case "copy":
        if (terminal.hasSelection())
          options.clipboard.copy(terminal.getSelection()).catch(() => {});
        return false;
      case "paste":
        options.clipboard.read().then(
          (text) => terminal.paste(text),
          () => {},
        );
        return false;
      case "search":
        options.onSearch();
        return false;
      default:
        return true;
    }
  });

  return {
    write: (bytes) => terminal.write(bytes),
    reset: () => terminal.reset(),
    open: (parent) => {
      terminal.open(parent);
      fit.fit();
    },
    fit: () => fit.fit(),
    setTheme: (theme) => {
      terminal.options.theme = theme;
    },
    setFontSize: (fontSize) => {
      terminal.options.fontSize = fontSize;
      fit.fit();
    },
    find: (text, direction) =>
      direction === "next" ? search.findNext(text) : search.findPrevious(text),
    clearFind: () => search.clearDecorations(),
    focus: () => terminal.focus(),
    dispose: () => {
      input.dispose();
      size.dispose();
      terminal.dispose();
    },
  };
}
