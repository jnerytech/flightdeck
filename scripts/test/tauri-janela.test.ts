import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const conf = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "..", "apps/desktop/src-tauri/tauri.conf.json"), "utf8"),
) as { app: { windows: Array<{ label: string; dragDropEnabled?: boolean }> } };

describe("tauri-janela: the main window lets the page handle drag and drop", () => {
  // On Windows, Tauri's native file drop (on by default) swallows the HTML5 dragover and drop
  // events in WebView2, so the Board's cards and the tabs could not be dragged with the mouse.
  // The app uses no file drop from Tauri, so the native handler is off.
  test("the main window turns Tauri's native drag and drop off", () => {
    const main = conf.app.windows.find((window) => window.label === "main");
    expect(main?.dragDropEnabled).toBe(false);
  });
});
