import { describe, expect, test } from "bun:test";
import type { Route } from "../src/lib/router.ts";
import { Tabs } from "../src/lib/tabs.ts";

const hub: Route = { name: "hub" };
const costs: Route = { name: "costs" };
const session = (id: string): Route => ({ name: "session", host: "h", id });

function setup() {
  let n = 0;
  const tabs = new Tabs({ name: "home" }, () => `t${++n}`);
  const routes = () => tabs.tabs.map((tab) => tab.router.current.name);
  return { tabs, routes };
}

describe("abas-unica: a screen has one tab", () => {
  test("opening a screen that already has a tab focuses it", () => {
    const { tabs, routes } = setup();
    tabs.open(hub);
    tabs.open(costs);
    expect(routes()).toEqual(["home", "hub", "costs"]);
    tabs.openPreview(hub);
    expect(routes()).toEqual(["home", "hub", "costs"]);
    expect(tabs.active.router.current).toEqual(hub);
  });

  test("the same route is the same tab whatever the order of its fields", () => {
    const { tabs, routes } = setup();
    tabs.open(session("s1"));
    tabs.openPreview({ id: "s1", host: "h", name: "session" });
    expect(routes()).toEqual(["home", "session"]);
  });

  test("a screen with another route still reuses the preview tab", () => {
    const { tabs, routes } = setup();
    tabs.openPreview(hub);
    tabs.openPreview(costs);
    expect(routes()).toEqual(["costs"]);
  });

  test("a ctrl or middle click still forces a new tab", () => {
    const { tabs, routes } = setup();
    tabs.openNextInNewTab();
    tabs.openPreview(hub);
    tabs.openNextInNewTab();
    tabs.openPreview(hub);
    expect(routes()).toEqual(["home", "hub", "hub"]);
  });

  test("tabs restored from an older snapshot lose their duplicates, keeping pins and the active one", () => {
    const tabs = Tabs.restore(
      [
        { route: hub, pinned: false },
        { route: costs, pinned: false },
        { route: hub, pinned: true },
        { route: costs, pinned: false },
      ],
      3,
    );
    expect(tabs.tabs.map((tab) => tab.router.current.name)).toEqual(["hub", "costs"]);
    expect(tabs.tabs[0]?.pinned).toBe(true);
    expect(tabs.active.router.current).toEqual(costs);
  });
});
