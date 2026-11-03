import { afterEach, describe, expect, test } from "bun:test";
import { seedDemoHosts } from "../src/demo/boot.ts";
import { AppStore, PALETTE_RECENTS_KEY } from "../src/lib/app-store.ts";
import { SHORTCUT_KEY } from "../src/lib/shortcut.ts";
import { memoryPlatform, TOKEN, waitFor } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const DEAD = "ws://127.0.0.1:1";

function make(focused = false) {
  const mem = memoryPlatform(focused);
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  return { ...mem, store };
}

describe("app-store-lacunas: the palette's recents", () => {
  test("a stored value that is not JSON gives an empty list", () => {
    const { store, items } = make();
    items.set(PALETTE_RECENTS_KEY, "{not json");
    expect(store.paletteRecents()).toEqual([]);
  });

  test("a stored value that is not a list gives an empty list; a list keeps only its strings", () => {
    const { store, items } = make();
    items.set(PALETTE_RECENTS_KEY, '{"a":1}');
    expect(store.paletteRecents()).toEqual([]);
    items.set(PALETTE_RECENTS_KEY, '["go:hub",3,"go:board",null]');
    expect(store.paletteRecents()).toEqual(["go:hub", "go:board"]);
  });
});

describe("app-store-lacunas: following sessions without opening them", () => {
  test("two followers of one session: the first to let go keeps the follow, the last ends it", () => {
    const { store } = make();
    const watched = (store as unknown as { watched: Map<string, number> }).watched;
    const first = store.watchSession("h", "s1");
    const second = store.watchSession("h", "s1");
    expect(watched.get("h/s1")).toBe(2);
    first();
    first();
    expect(watched.get("h/s1")).toBe(1);
    second();
    expect(watched.has("h/s1")).toBe(false);
  });

  test("a session followed before its host connects is subscribed when the host connects", async () => {
    const daemon = legacyDaemon(cleanups);
    const mem = memoryPlatform();
    seedDemoHosts(mem.platform.storage, mem.tokens, [
      { id: "h1", name: "alfa", url: daemon.url, token: TOKEN },
    ]);
    const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    store.watchSession("h1", "s-early");
    await store.init();
    await waitFor(
      () =>
        daemon.commands.some(
          (c) =>
            c.type === "session.subscribe" &&
            (c.payload as { sessionId: string }).sessionId === "s-early",
        ),
      "subscribe of the followed session",
    );
  });
});

describe("app-store-lacunas: a host that does not answer", () => {
  test("sending to it raises an error notice instead of throwing", async () => {
    const { store } = make();
    const hostId = await store.addHost({ name: "alfa", url: DEAD, token: TOKEN });
    await store.sendTo(hostId, "s1", "hello");
    expect(store.getState().notices.map((n) => n.kind)).toEqual(["error"]);
  });

  test("following its account does not throw and leaves the account unknown", async () => {
    const { store } = make();
    const hostId = await store.addHost({ name: "alfa", url: DEAD, token: TOKEN });
    const stop = store.watchAccount(hostId);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.getState().account[hostId]).toBeUndefined();
    stop();
  });
});

describe("app-store-lacunas: the global shortcut", () => {
  function withShortcut(failOn: string[] = []) {
    const mem = memoryPlatform();
    const calls: string[] = [];
    mem.platform.globalShortcut = {
      supported: true,
      register: async (accelerator) => {
        calls.push(`register ${accelerator}`);
        if (failOn.includes(accelerator)) throw new Error("taken");
      },
      unregister: async (accelerator) => {
        calls.push(`unregister ${accelerator}`);
      },
    };
    const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    return { ...mem, store, calls };
  }

  test("a malformed shortcut is refused with the reason and nothing is registered", async () => {
    const { store, calls, items } = withShortcut();
    await store.setGlobalShortcut("nonsense");
    expect(store.getState().settings.shortcutError).not.toBeNull();
    expect(calls).toEqual([]);
    expect(items.has(SHORTCUT_KEY)).toBe(false);
  });

  test("a valid one replaces the registered shortcut and is saved", async () => {
    const { store, calls, items } = withShortcut();
    await store.init();
    calls.length = 0;
    await store.setGlobalShortcut("Ctrl+Shift+J");
    expect(calls.at(-1)).toBe("register Ctrl+Shift+J");
    expect(calls.some((c) => c.startsWith("unregister "))).toBe(true);
    expect(items.get(SHORTCUT_KEY)).toBe("Ctrl+Shift+J");
    expect(store.getState().settings.globalShortcut).toBe("Ctrl+Shift+J");
  });

  test("one the OS refuses is not saved and the problem is shown", async () => {
    const { store, items } = withShortcut(["Ctrl+Shift+J"]);
    await store.init();
    await store.setGlobalShortcut("Ctrl+Shift+J");
    expect(items.has(SHORTCUT_KEY)).toBe(false);
    expect(store.getState().settings.shortcutProblem).not.toBeNull();
  });
});

describe("app-store-lacunas: a card that needs you but is unknown here", () => {
  test("the OS is told with the card id as the title and no route to open", async () => {
    const daemon = legacyDaemon(cleanups);
    daemon.features.push("watch");
    const { store, notifications } = make();
    await store.addHost({ name: "alfa", url: daemon.url, token: TOKEN });
    await waitFor(() => store.getState().hosts[0]?.hostInfo != null, "host info");
    daemon.push({
      type: "watch.updated",
      watch: { cardId: "ghost", enabled: true, status: "needs_you", reason: "stuck", rounds: [] },
    });
    await waitFor(() => notifications.length > 0, "notification");
    expect(notifications[0]?.body).toBe("ghost: stuck");
  });
});
