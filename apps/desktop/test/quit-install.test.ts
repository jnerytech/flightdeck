import { describe, expect, test } from "bun:test";
import { tauriPlatform } from "../src/platform/tauri/index.ts";

describe("quit-install: the tray's Quit asks the app first (issue #402)", () => {
  test("the app hears quit-requested from the Rust shell, and quitNow asks the shell to exit", async () => {
    const calls: string[] = [];
    const call = (async (cmd: string) => {
      calls.push(cmd);
    }) as Parameters<typeof tauriPlatform>[1];
    const heard: string[] = [];
    let fire: (() => void) | null = null;
    let unlistened = 0;
    const listen = (async (event: string, handler: () => void) => {
      heard.push(event);
      fire = handler;
      return () => {
        unlistened++;
      };
    }) as unknown as Parameters<typeof tauriPlatform>[2];
    const win = {
      localStorage: { getItem: () => null, setItem: () => {} },
      document: { hasFocus: () => true },
      navigator: { clipboard: { writeText: async () => {} } },
    };
    const platform = tauriPlatform(win as never, call, listen);
    let asked = 0;
    const off = platform.onQuitRequested(() => {
      asked++;
    });
    await Promise.resolve();
    expect(heard).toEqual(["quit-requested"]);
    (fire as (() => void) | null)?.();
    expect(asked).toBe(1);
    await platform.quitNow();
    expect(calls).toEqual(["quit_now"]);
    off();
    await Promise.resolve();
    expect(unlistened).toBe(1);
  });
});
