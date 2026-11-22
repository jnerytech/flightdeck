/**
 * #4001: the web build saves a file through the browser's save dialog, which a print cannot answer.
 * `keepSaves` replaces it, inside the page, with one that keeps what is written in `__saved`.
 */
export interface KeptSave {
  name: string;
  text: string;
}

export interface SaveWindow {
  showSaveFilePicker?: unknown;
  __saved?: KeptSave;
}

/** Self-contained: Playwright sends its source to the page, so it names nothing outside itself. */
export function keepSaves(win: SaveWindow): void {
  win.showSaveFilePicker = async () => ({
    createWritable: async () => ({
      write: async () => {},
      close: async () => {},
    }),
  });
}
