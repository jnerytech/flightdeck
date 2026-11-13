import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { AWAY_KEY } from "../../src/features/needs-you/away.ts";
import { AppStore } from "../../src/lib/app-store.ts";
import { memoryPlatform } from "../fixtures.ts";

/** The start and the stop of the app (#2376): its minute timer and the tray's Quit. */
const NOW = Date.parse("2026-11-09T08:00:00.000Z");
const MINUTE = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

let clock = NOW;
beforeEach(() => {
  clock = NOW;
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

function start() {
  const mem = memoryPlatform(false, "en");
  const quit: { ask: (() => void) | null } = { ask: null };
  const calls: string[] = [];
  mem.platform.onQuitRequested = (handler) => {
    quit.ask = handler;
    return () => {
      quit.ask = null;
    };
  };
  const quitted = new Promise<void>((resolve) => {
    mem.platform.quitNow = async () => {
      calls.push("quitNow");
      resolve();
    };
  });
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000, now: () => clock });
  return { store, mem, quit, calls, quitted };
}

describe("app lifecycle: init and dispose (#2376)", () => {
  test("the app writes its active time every minute, and stops writing when it is disposed", async () => {
    const { store, mem } = start();
    await store.init();
    expect(mem.items.get(AWAY_KEY)).toBe(iso(NOW));
    clock = NOW + MINUTE;
    jest.advanceTimersByTime(MINUTE);
    expect(mem.items.get(AWAY_KEY)).toBe(iso(NOW + MINUTE));
    store.dispose();
    clock = NOW + 5 * MINUTE;
    jest.advanceTimersByTime(MINUTE);
    expect(mem.items.get(AWAY_KEY)).toBe(iso(NOW + MINUTE));
  });

  test("starting again leaves one minute timer, not two", async () => {
    const { store, mem } = start();
    await store.init();
    await store.init();
    clock = NOW + MINUTE;
    let writes = 0;
    const set = mem.platform.storage.setItem.bind(mem.platform.storage);
    mem.platform.storage.setItem = (key, value) => {
      if (key === AWAY_KEY) writes++;
      set(key, value);
    };
    jest.advanceTimersByTime(MINUTE);
    store.dispose();
    expect(writes).toBe(1);
  });

  test("the tray's Quit is heard until the app is disposed, and asks the app to exit", async () => {
    const { store, quit, calls, quitted } = start();
    await store.init();
    expect(quit.ask).not.toBeNull();
    quit.ask?.();
    await quitted;
    expect(calls).toEqual(["quitNow"]);
    store.dispose();
    expect(quit.ask).toBeNull();
  });
});
