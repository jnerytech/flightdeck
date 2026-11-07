import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GUARD_SIZES } from "../lib/layout-guards.ts";

const conf = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "..", "apps/desktop/src-tauri/tauri.conf.json"), "utf8"),
) as {
  app: {
    windows: Array<{
      label: string;
      dragDropEnabled?: boolean;
      width?: number;
      height?: number;
      minWidth?: number;
      minHeight?: number;
    }>;
  };
};

describe("tauri-janela: the main window can shrink to a phone-width floor (issue #641)", () => {
  // The shell has a drawer below 640 px, so the window may go down to 360 x 480 (the layout decision's
  // floor) while it opens at 1200 x 800 as before.
  test("the main window's floor is 360 x 480 and it opens at 1200 x 800", () => {
    const main = conf.app.windows.find((window) => window.label === "main");
    expect([main?.minWidth, main?.minHeight]).toEqual([360, 480]);
    expect([main?.width, main?.height]).toEqual([1200, 800]);
  });

  test("the layout guard measures the floor, so the smallest window is never unchecked", () => {
    const main = conf.app.windows.find((window) => window.label === "main");
    const floor = { width: main?.minWidth, height: main?.minHeight };
    expect(
      GUARD_SIZES.some((size) => size.width === floor.width && size.height === floor.height),
    ).toBe(true);
  });
});

describe("tauri-janela: the main window lets the page handle drag and drop", () => {
  // On Windows, Tauri's native file drop (on by default) swallows the HTML5 dragover and drop
  // events in WebView2, so the Board's cards and the tabs could not be dragged with the mouse.
  // The app uses no file drop from Tauri, so the native handler is off.
  test("the main window turns Tauri's native drag and drop off", () => {
    const main = conf.app.windows.find((window) => window.label === "main");
    expect(main?.dragDropEnabled).toBe(false);
  });
});
