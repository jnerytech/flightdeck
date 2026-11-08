import type { PickedFile } from "./types.ts";

/** A key file or a backup is a few KiB; anything bigger is not one (the desktop shell holds the same cap). */
export const PICKED_FILE_MAX_BYTES = 1024 * 1024;

/** What a page's file input hands over. */
export interface PickableFile {
  name: string;
  size: number;
  text(): Promise<string>;
}

/** The part of an `<input type="file">` the picker uses. */
export interface PickInput {
  type: string;
  files: ArrayLike<PickableFile> | null;
  click(): void;
  addEventListener(type: "change" | "cancel", listener: () => void): void;
}

/** The part of `document` the picker uses. */
export interface PickDocument {
  createElement(tag: "input"): PickInput;
}

/**
 * The browser's file dialog, through a file input: the chosen file read as text, or `null` when the
 * person cancels. A file over the cap is refused before it is read, as the desktop shell does.
 */
export function pickWithInput(doc: PickDocument): Promise<PickedFile | null> {
  return new Promise((resolve, reject) => {
    const input = doc.createElement("input");
    input.type = "file";
    input.addEventListener("cancel", () => resolve(null));
    input.addEventListener("change", () => {
      const chosen = input.files?.[0];
      if (!chosen) return resolve(null);
      if (chosen.size > PICKED_FILE_MAX_BYTES) {
        return reject(new Error("the file is too big to be a key"));
      }
      chosen.text().then(
        (text) => resolve({ path: chosen.name, text }),
        (error: unknown) => reject(error),
      );
    });
    input.click();
  });
}
