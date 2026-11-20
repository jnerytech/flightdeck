import { describe, expect, test } from "bun:test";
import { seedDemoHosts } from "../../src/demo/boot.ts";
import { registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { AppStore } = await import("../../src/lib/app-store.ts");

/** What `flightdeckd --host` reads is kept in step with the host list (#3429). */
const PI = "0b6a3f6e-5f0e-4a39-9c43-5d1d1c2b7a11";
const DESK = "5c1d9a0e-1b2c-4d3e-8f40-aabbccddeeff";
type Listed = Array<{ id: string; name: string; url: string }>;

function start(sync?: (hosts: Listed) => Promise<void>) {
  const mem = memoryPlatform(false, "en");
  seedDemoHosts(mem.win.localStorage, mem.tokens, [
    { id: PI, name: "Pi", url: "ws://127.0.0.1:1/v1/ws", token: "tok-SECRET-1" },
    { id: DESK, name: "Desk", url: "ws://127.0.0.1:2/v1/ws", token: "tok-SECRET-2" },
  ]);
  const sent: Listed[] = [];
  mem.platform.hostIndex = {
    sync: async (hosts) => {
      sent.push(hosts);
      await sync?.(hosts);
    },
  };
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  return { store, sent };
}

describe("host index sync: the CLI's names and addresses follow the host list (#3429)", () => {
  test("the app start sends every saved host's id, name and address, and no token", async () => {
    const { store, sent } = start();
    await store.init();
    store.dispose();
    expect(sent).toEqual([
      [
        { id: PI, name: "Pi", url: "ws://127.0.0.1:1/v1/ws" },
        { id: DESK, name: "Desk", url: "ws://127.0.0.1:2/v1/ws" },
      ],
    ]);
    expect(JSON.stringify(sent).includes("SECRET")).toBe(false);
  });

  test("a rename sends the list again with the new name", async () => {
    const { store, sent } = start();
    await store.init();
    store.roster.rename(PI, "Orange Pi");
    store.dispose();
    expect(sent.at(-1)?.map((host) => host.name)).toEqual(["Orange Pi", "Desk"]);
  });

  test("a removed host leaves the list that is sent", async () => {
    const { store, sent } = start();
    await store.init();
    await store.roster.remove(PI);
    store.dispose();
    expect(sent.at(-1)?.map((host) => host.id)).toEqual([DESK]);
  });

  test("a store that refuses the sync does not stop the app from starting or a rename from saving", async () => {
    const { store, sent } = start(() => Promise.reject(new Error("the store is locked")));
    await store.init();
    const error = store.roster.rename(PI, "Orange Pi");
    store.dispose();
    expect({ error, syncs: sent.length }).toEqual({ error: null, syncs: 2 });
  });
});
