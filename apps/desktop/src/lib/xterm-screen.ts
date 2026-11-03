import {
  FIND_DECORATIONS,
  type FindDecorations,
  type TerminalColors,
  terminalKeyAction,
} from "./terminal-view.ts";

/** The slice of xterm's Terminal the app uses; a fake stands in for it in the tests. */
export interface XtermTerminal {
  cols: number;
  rows: number;
  options: { theme?: TerminalColors; fontSize?: number; fontFamily?: string };
  unicode: { activeVersion: string };
  loadAddon(addon: unknown): void;
  open(parent: HTMLElement): void;
  write(data: Uint8Array, callback?: () => void): void;
  reset(): void;
  focus(): void;
  paste(text: string): void;
  selectAll(): void;
  hasSelection(): boolean;
  getSelection(): string;
  onData(listener: (data: string) => void): { dispose(): void };
  onResize(listener: (size: { cols: number; rows: number }) => void): { dispose(): void };
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void;
  dispose(): void;
}

export interface XtermFindOptions {
  /** Keep the current match while the text grows, as typing in a find bar does. */
  incremental?: boolean;
  /** Highlights every match and marks the current one. */
  decorations: FindDecorations;
}

/** Where the current match sits among all of them; `resultIndex` is -1 past the highlight limit. */
export interface FindResults {
  resultIndex: number;
  resultCount: number;
}

export interface XtermSearch {
  findNext(text: string, options?: XtermFindOptions): boolean;
  findPrevious(text: string, options?: XtermFindOptions): boolean;
  clearDecorations(): void;
  onDidChangeResults(listener: (results: FindResults) => void): { dispose(): void };
}

/** Builds the xterm pieces; the real ones come from `xterm-deps.ts`, fakes from the tests. */
export interface XtermDeps {
  terminal(options: Record<string, unknown>): XtermTerminal;
  fit(): { fit(): void };
  webLinks(open: (uri: string) => void): unknown;
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
  /** The matches of the find bar changed (typing, next, previous). */
  onFindResults?(results: FindResults): void;
  /** A link in the output was clicked. */
  onLink(uri: string): void;
  /** Ctrl+Shift+Space: the snippets (phase 18). */
  onSnippets?(): void;
}

export interface XtermScreen {
  write(bytes: Uint8Array, done?: () => void): void;
  reset(): void;
  open(parent: HTMLElement): void;
  fit(): void;
  setTheme(theme: TerminalColors): void;
  setFontSize(size: number): void;
  find(text: string, direction: "next" | "previous", incremental?: boolean): boolean;
  clearFind(): void;
  focus(): void;
  /** The selection to the clipboard, as Ctrl+Shift+C does. */
  copy(): void;
  /** The clipboard into the terminal, as Ctrl+Shift+V does. */
  paste(): void;
  selectAll(): void;
  hasSelection(): boolean;
  dispose(): void;
}

export function createXtermScreen(deps: XtermDeps, options: XtermScreenOptions): XtermScreen {
  const terminal = deps.terminal({
    theme: options.theme,
    fontSize: options.fontSize,
    fontFamily: options.fontFamily,
    cursorBlink: true,
    allowProposedApi: true,
  });
  const fit = deps.fit();
  const search = deps.search();
  for (const addon of [fit, deps.webLinks(options.onLink), search, deps.unicode11()])
    terminal.loadAddon(addon);
  terminal.unicode.activeVersion = "11";

  const copy = () => {
    if (terminal.hasSelection()) options.clipboard.copy(terminal.getSelection()).catch(() => {});
  };
  const paste = () => {
    options.clipboard.read().then(
      (text) => terminal.paste(text),
      () => {},
    );
  };
  const results = search.onDidChangeResults((found) => options.onFindResults?.(found));
  const input = terminal.onData(options.onInput);
  const size = terminal.onResize(({ cols, rows }) => options.onResize(cols, rows));
  terminal.attachCustomKeyEventHandler((event) => {
    switch (terminalKeyAction(event)) {
      case "copy":
        copy();
        return false;
      case "paste":
        paste();
        return false;
      case "search":
        options.onSearch();
        return false;
      case "snippets":
        options.onSnippets?.();
        return false;
      default:
        return true;
    }
  });

  return {
    write: (bytes, done) => terminal.write(bytes, done),
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
    find: (text, direction, incremental = false) => {
      const found = { incremental, decorations: FIND_DECORATIONS };
      return direction === "next" ? search.findNext(text, found) : search.findPrevious(text, found);
    },
    clearFind: () => search.clearDecorations(),
    focus: () => terminal.focus(),
    copy,
    paste,
    selectAll: () => terminal.selectAll(),
    hasSelection: () => terminal.hasSelection(),
    dispose: () => {
      results.dispose();
      input.dispose();
      size.dispose();
      terminal.dispose();
    },
  };
}
