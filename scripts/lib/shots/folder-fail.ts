/**
 * #4001: the demo's backup folder keeps its files in the page's storage (`flightdeck.demoBackupFolder`),
 * so a folder that cannot be written is a storage that refuses that key. `failFolderWrites` makes it so,
 * inside the page, for the print of "the last backup could not be saved". `allowed` writes pass first:
 * one lets a backup be saved and the removal of an old file after it fail.
 */
export interface StorageWindow {
  Storage: { prototype: { setItem(this: unknown, key: string, value: string): void } };
}

/** Self-contained: Playwright sends its source to the page, so it names nothing outside itself. */
export function failFolderWrites(win: StorageWindow, key: string, allowed = 0): void {
  const proto = win.Storage.prototype;
  const original = proto.setItem;
  let passed = 0;
  proto.setItem = function (this: unknown, name: string, value: string) {
    if (name === key && passed++ >= allowed) throw new Error("the folder is full");
    return original.call(this, name, value);
  };
}
