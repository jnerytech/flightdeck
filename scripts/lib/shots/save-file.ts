/**
 * #4001: the web build saves a file through the browser's save dialog, which a print cannot answer.
 * `keepSaves` replaces it, inside the page, with one that keeps what is written in `__saved`.
 */
interface KeptSave {
  name: string;
  text: string;
}

export interface SaveWindow {
  showSaveFilePicker?: unknown;
  __saved?: KeptSave;
}

/** Self-contained: Playwright sends its source to the page, so it names nothing outside itself. */
export function keepSaves(win: SaveWindow): void {
  win.showSaveFilePicker = (options: { suggestedName: string }) =>
    Promise.resolve({
      createWritable: () =>
        Promise.resolve({
          write: (text: string) => {
            win.__saved = { name: options.suggestedName, text };
            return Promise.resolve();
          },
          close: () => Promise.resolve(),
        }),
    });
}

/** The part of the page the file offer touches. */
export interface OfferWindow {
  __saved?: KeptSave;
  document: { createElement(tag: string): unknown };
}

/**
 * #4001: the web build reads a backup through a file input the print cannot click. `offerBackup` makes
 * every input the page creates "choose" the file `keepSaves` kept (or cancel when none was kept).
 * Self-contained, like `keepSaves`.
 */
export function offerBackup(win: OfferWindow): void {
  const make = win.document.createElement.bind(win.document);
  win.document.createElement = (tag: string) => {
    const element = make(tag) as {
      files?: unknown;
      click?: () => void;
      dispatchEvent(event: Event): boolean;
    };
    if (tag.toLowerCase() !== "input") return element;
    const own = element.click?.bind(element);
    element.click = () => {
      // Only the file input the picker made: the type is set after the element is created.
      if ((element as { type?: string }).type !== "file") return own?.();
      const kept = win.__saved;
      Object.defineProperty(element, "files", {
        configurable: true,
        value: kept
          ? [{ name: kept.name, size: kept.text.length, text: () => Promise.resolve(kept.text) }]
          : null,
      });
      element.dispatchEvent(new Event(kept ? "change" : "cancel"));
    };
    return element;
  };
}
