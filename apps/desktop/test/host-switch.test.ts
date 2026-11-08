import { afterEach, describe, expect, test } from "bun:test";
import { AppStore } from "../src/lib/app-store.ts";
import { HostTabs } from "../src/lib/host-tabs.ts";
import { HOSTS_KEY } from "../src/lib/hosts.ts";
import { memoryPlatform } from "./fixtures.ts";
import type { Route } from "../src/lib/router.ts";

const project = (host: string, projectId: string): Route => ({ name: "project", host, projectId });

/** A window on alfa's project page, after a pick of alfa in the switcher. */
function onAlfa() {
  let n = 0;
  const tabs = HostTabs.restore(null, () => `t${++n}`, { name: "home" });
  tabs.switchHost("h1");
  tabs.router.push(project("h1", "p-api"));
  const switched: Array<[string | null, string]> = [];
  tabs.onSwitch((from, to) => void switched.push([from, to]));
  return { tabs, switched };
}

// #932: opening another host's project says so, and Back returns to the host and page it left.
describe("host-switch: a navigation into another host's tabs", () => {
  test("Back returns to the host and the page the switch left", () => {
    const { tabs } = onAlfa();
    tabs.router.push(project("h2", "p-docs"));
    const there = { host: tabs.hostId, back: tabs.router.canBack };
    tabs.router.back();
    expect({ there, host: tabs.hostId, page: tabs.router.current }).toEqual({
      there: { host: "h2", back: true },
      host: "h1",
      page: project("h1", "p-api"),
    });
  });

  test("the switch is told once, with both hosts; a page of the same host tells nothing", () => {
    const { tabs, switched } = onAlfa();
    tabs.router.push(project("h1", "p-web"));
    tabs.router.push(project("h2", "p-docs"));
    expect(switched).toEqual([["h1", "h2"]]);
  });

  test("a pick in the switcher forgets the way back", () => {
    const { tabs } = onAlfa();
    tabs.router.push(project("h2", "p-docs"));
    tabs.switchHost("h2");
    expect(tabs.router.canBack).toBe(false);
  });
});

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("host-switch: the window says the switch, with a way back", () => {
  test("a toast names the host it switched to, and its button goes back to the one it left", async () => {
    const mem = memoryPlatform(false, "en");
    mem.platform.storage.setItem(
      HOSTS_KEY,
      JSON.stringify([
        { id: "h1", name: "alfa", url: "ws://x" },
        { id: "h2", name: "beta", url: "ws://x" },
      ]),
    );
    const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
    cleanups.push(() => store.dispose());
    await store.init();
    store.pickHost("h1");
    store.router.push(project("h1", "p-api"));
    store.router.push(project("h2", "p-docs"));
    const toast = store.getState().notices.at(-1);
    toast?.link?.run();
    expect({
      text: toast?.text,
      button: toast?.link?.label,
      host: store.activeHostId(),
    }).toEqual({ text: "Switched to beta", button: "Back to alfa", host: "h1" });
  });

  // The e2e journey of #932: after a reload the tabs have no host of their own, and the switcher
  // names the window's host. Opening that host's project switches nothing, so nothing is said.
  test("from no tabs' host, opening the project of the host the switcher names says nothing", async () => {
    const mem = memoryPlatform(false, "en");
    mem.platform.storage.setItem(
      HOSTS_KEY,
      JSON.stringify([
        { id: "h1", name: "alfa", url: "ws://x" },
        { id: "h2", name: "beta", url: "ws://x" },
      ]),
    );
    const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
    cleanups.push(() => store.dispose());
    await store.init();
    store.select("h1", null);
    const before = store.getState().notices.length;
    store.router.push(project("h1", "p-api"));
    expect({ named: store.uiHostId(), said: store.getState().notices.length - before }).toEqual({
      named: "h1",
      said: 0,
    });
  });
});
