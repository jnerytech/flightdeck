import { describe, expect, test } from "bun:test";
import { seedDemoHosts } from "../src/demo/boot.ts";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { AppStore } = await import("../src/lib/app-store.ts");
const { WORKSPACE_KEY } = await import("../src/lib/workspace.ts");

function twoHosts() {
  const mem = memoryPlatform(false, "en");
  seedDemoHosts(mem.win.localStorage, mem.tokens, [
    { id: "ha", name: "alfa", url: "ws://127.0.0.1:1", token: "t" },
    { id: "hb", name: "beta", url: "ws://127.0.0.1:1", token: "t" },
  ]);
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  return { store, mem };
}

const names = (store: InstanceType<typeof AppStore>) =>
  store.hostTabs.workspace?.tabs.tabs.map((tab) => tab.router.current.name) ?? [];

describe("host-tabs-store: each host has its own tabs in the app's store (issue #644)", () => {
  test("a screen of a host opens in that host's set, and the router follows the active tab", () => {
    const { store } = twoHosts();
    store.router.push({ name: "projects", host: "ha" });
    expect(store.hostTabs.hostId).toBe("ha");
    store.router.push({ name: "projects", host: "hb" });
    expect(store.hostTabs.hostId).toBe("hb");
    expect(names(store)).toEqual(["projects"]);
    // The first host kept its own tab.
    store.hostTabs.switchHost("ha");
    expect(store.router.current).toEqual({ name: "projects", host: "ha" });
    expect(store.tabs === store.hostTabs.workspace?.tabs).toBe(true);
  });

  test("a shared screen shows in the shared set, and store.tabs is the active set's tabs", () => {
    const { store } = twoHosts();
    store.router.push({ name: "projects", host: "ha" });
    store.router.push({ name: "settings" });
    expect(store.hostTabs.onShared).toBe(true);
    expect(store.tabs === store.hostTabs.shared).toBe(true);
    expect(store.router.current).toEqual({ name: "settings" });
    // The fresh window's Home and Settings are pinned: they sit at the left of every host's row.
    expect(store.hostTabs.shared.tabs.map((tab) => tab.router.current.name)).toEqual([
      "home",
      "settings",
    ]);
    expect(store.hostTabs.shared.tabs.every((tab) => tab.pinned)).toBe(true);
  });

  test("the window is kept as a v2 snapshot, with one set per host", () => {
    const { store, mem } = twoHosts();
    store.router.push({ name: "projects", host: "ha" });
    store.router.push({ name: "projects", host: "hb" });
    const kept = JSON.parse(mem.platform.storage.getItem(WORKSPACE_KEY) ?? "null");
    expect(kept.v).toBe(2);
    expect(Object.keys(kept.hosts).sort()).toEqual(["ha", "hb"]);
    expect(kept.host).toBe("hb");
  });

  test("the switcher's host is the active tab's host, and picking a host swaps the row", () => {
    const { store } = twoHosts();
    store.router.push({ name: "projects", host: "ha" });
    expect(store.activeHostId()).toBe("ha");
    store.pickHost("hb");
    expect(store.activeHostId()).toBe("hb");
    expect(store.router.current).toEqual({ name: "host", host: "hb" });
    store.router.push({ name: "projects", host: "ha" });
    expect(store.activeHostId()).toBe("ha");
  });

  test("removing a host through the store drops its set, and the switcher moves off it", async () => {
    const { store } = twoHosts();
    store.router.push({ name: "projects", host: "ha" });
    store.router.push({ name: "projects", host: "hb" });
    await store.removeHost("hb");
    expect(Object.keys(store.hostTabs.snapshot().hosts)).toEqual(["ha"]);
    expect(store.activeHostId()).toBe("ha");
    await store.removeHost("ha");
    expect(Object.keys(store.hostTabs.snapshot().hosts)).toEqual([]);
    expect(store.activeHostId()).toBeNull();
  });

  test("a kept set of a host that is no longer configured does not come back", () => {
    const { mem } = twoHosts();
    const snapshot = (hosts: Record<string, unknown>, host: string) =>
      JSON.stringify({
        v: 2,
        shared: { tabs: [{ route: { name: "home" }, pinned: true }], active: 0 },
        hosts,
        host,
        onShared: false,
      });
    const set = (id: string) => ({
      v: 1,
      areas: [{ tabs: [{ route: { name: "projects", host: id }, pinned: false }], active: 0 }],
      split: null,
      focus: 0,
      fraction: 0.5,
    });
    mem.items.set(WORKSPACE_KEY, snapshot({ ha: set("ha"), gone: set("gone") }, "gone"));
    const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
    expect(Object.keys(store.hostTabs.snapshot().hosts)).toEqual(["ha"]);
    expect(store.activeHostId()).toBe("ha");
  });
  test("the groups are each host's tabs, host by host, and a tab of another host can be activated", () => {
    const { store } = twoHosts();
    store.router.push({ name: "history", host: "ha" });
    store.router.push({ name: "projects", host: "ha" });
    store.router.push({ name: "history", host: "hb" });
    const groups = store.hostTabs.groups();
    expect(groups.map((g) => g.hostId)).toEqual(["ha", "hb"]);
    expect(groups.map((g) => g.tabs.tabs.map((tab) => tab.router.current.name))).toEqual([
      ["history", "projects"],
      ["history"],
    ]);
    // The tab is of the other host: activating it switches the host and shows the tab.
    const first = groups[0]?.tabs.tabs[0];
    expect(store.hostTabs.hostId).toBe("hb");
    store.hostTabs.activate(first?.id ?? "");
    expect(store.hostTabs.hostId).toBe("ha");
    expect(store.router.current).toEqual({ name: "history", host: "ha" });
    expect(store.hostTabs.onShared).toBe(false);
  });
  test("closing a terminal tab of another host waits for the answer, then closes that host's tab", async () => {
    const { store } = twoHosts();
    store.router.push({ name: "terminal", host: "ha", terminalId: "t1" } as never);
    store.router.push({ name: "history", host: "hb" });
    const group = store.hostTabs.groups().find((g) => g.hostId === "ha");
    const tab = group?.tabs.tabs[0];
    expect(tab?.router.current.name).toBe("terminal");
    (store as unknown as { hostCommand: () => Promise<unknown> }).hostCommand = async () => ({});
    store.closeTab(group?.tabs as never, tab?.id ?? "");
    expect(store.getState().closingTerminal?.tabId).toBe(tab?.id);
    await store.finishCloseTerminal(false);
    const after = store.hostTabs.groups().find((g) => g.hostId === "ha");
    expect(after?.tabs.tabs.some((other) => other.id === tab?.id)).toBe(false);
  });
});
