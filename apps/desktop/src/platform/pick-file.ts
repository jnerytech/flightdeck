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
 * person cancels. Stub.
 */
export function pickWithInput(_doc: PickDocument): Promise<PickedFile | null> {
  return Promise.resolve(null);
}
