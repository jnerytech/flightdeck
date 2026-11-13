import { afterEach, describe, expect, test } from "bun:test";
import { memoryPlatform } from "../fixtures.ts";

const { AppStore } = await import("../../src/lib/app-store.ts");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("app-store init: a host added while it starts (#1718)", () => {
  test("a host added during init is listed once, not again from the saved hosts", async () => {
    const mem = memoryPlatform();
    // The tray's answer is held: init is suspended after it reset the hosts, before it reads them.
    let release: () => void = () => {};
    mem.platform.setCloseToTray = () => new Promise<void>((resolve) => (release = resolve));
    const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    const started = store.init();
    const id = await store.roster.add({ name: "alfa", url: "ws://127.0.0.1:9", token: "t" });
    release();
    await started;
    expect(store.getState().hosts.map((h) => h.id)).toEqual([id]);
  });
});
