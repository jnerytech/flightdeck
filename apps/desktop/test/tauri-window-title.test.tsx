import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { registerDom } from "./dom.ts";

registerDom();
const { tauriPlatform } = await import("../src/platform/tauri/index.ts");

const DESKTOP = resolve(import.meta.dir, "..");

describe("tauri-window-title: the window's title in the Tauri shell (issue #88)", () => {
  test("the title goes to the window plugin, and the capability grants it", async () => {
    const calls: Array<[string, unknown]> = [];
    const call = (async (cmd: string, args?: unknown) => {
      calls.push([cmd, args]);
    }) as Parameters<typeof tauriPlatform>[1];
    const win = {
      localStorage: { getItem: () => null, setItem: () => {} },
      document: { hasFocus: () => true },
      navigator: { clipboard: { writeText: async () => {} } },
    };
    const platform = tauriPlatform(win, call);
    expect(platform.setTitle).toBeDefined();
    await platform.setTitle?.("Flightdeck: 2 tasks waiting for your answer");
    expect(calls).toEqual([
      [
        "plugin:window|set_title",
        { label: "main", value: "Flightdeck: 2 tasks waiting for your answer" },
      ],
    ]);
    const capability = JSON.parse(
      readFileSync(resolve(DESKTOP, "src-tauri/capabilities/default.json"), "utf8"),
    ) as { permissions: string[] };
    expect(capability.permissions).toContain("core:window:allow-set-title");
  });
});
