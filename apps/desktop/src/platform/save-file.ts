/** The File System Access save dialog (Chromium and WebView2; not in WebKit). */
export interface FilePickerWindow {
  showSaveFilePicker?(options: { suggestedName: string }): Promise<{
    createWritable(): Promise<{ write(text: string): Promise<void>; close(): Promise<void> }>;
  }>;
}

/** Saves `text` through the system's save dialog; `false` when the user cancels it. */
export async function saveWithPicker(
  win: FilePickerWindow,
  name: string,
  text: string,
): Promise<boolean> {
  if (!win.showSaveFilePicker) throw new Error("salvar arquivo indisponível nesta plataforma");
  const handle = await win
    .showSaveFilePicker({ suggestedName: name })
    .catch((error: Error) => (error.name === "AbortError" ? null : Promise.reject(error)));
  if (!handle) return false;
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
  return true;
}
