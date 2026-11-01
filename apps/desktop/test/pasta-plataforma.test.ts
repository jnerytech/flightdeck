import { describe, expect, test } from "bun:test";
import { AppStore } from "../src/lib/app-store.ts";
import { tauriPlatform } from "../src/platform/tauri/index.ts";
import { createWebPlatform } from "../src/platform/web/index.ts";
import { memoryPlatform } from "./fixtures.ts";

describe("pasta: the system's folder dialog", () => {
  test("tauri: the desktop shell opens it through pick_folder, and cancelling gives null", async () => {
    const invokes: Array<[string, unknown]> = [];
    let answer: string | null = "/home/a/code";
    const call = (async (cmd: string, args?: unknown) => {
      invokes.push([cmd, args]);
      return cmd === "pick_folder" ? answer : undefined;
    }) as never;
    const platform = tauriPlatform({} as never, call);
    expect(await platform.pickFolder?.()).toBe("/home/a/code");
    answer = null;
    expect(await platform.pickFolder?.()).toBeNull();
    expect(invokes).toEqual([
      ["pick_folder", undefined],
      ["pick_folder", undefined],
    ]);
  });

  test("a browser has no such dialog: the store says so and picks nothing", async () => {
    expect(createWebPlatform({} as never).pickFolder).toBeUndefined();
    const store = new AppStore(memoryPlatform(false, "en").platform);
    expect(store.canPickFolder()).toBe(false);
    expect(await store.pickFolder()).toBeNull();
  });

  test("the store offers the dialog when the platform has one, and a dialog that breaks is an error, not a crash", async () => {
    const mem = memoryPlatform(false, "en");
    let broken = false;
    (mem.platform as { pickFolder?: () => Promise<string | null> }).pickFolder = async () => {
      if (broken) throw new Error("the dialog failed");
      return "/work";
    };
    const store = new AppStore(mem.platform);
    expect(store.canPickFolder()).toBe(true);
    expect(await store.pickFolder()).toBe("/work");
    broken = true;
    expect(await store.pickFolder()).toBeNull();
    expect(store.getState().error).toContain("the dialog failed");
  });
});
