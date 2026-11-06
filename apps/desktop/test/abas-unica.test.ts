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

  test("a link inside a tab to a screen another tab shows focuses that tab (#576)", () => {
    const { tabs, routes } = setup();
    tabs.open(hub);
    tabs.open(costs);
    const from = tabs.active;
    tabs.router.push({ name: "hub" });
    expect(routes()).toEqual(["home", "hub", "costs"]);
    expect(tabs.active.router.current).toEqual(hub);
    expect(from.router.current).toEqual(costs);
  });

  test("a link to a screen no other tab shows still navigates in place (#576)", () => {
    const { tabs, routes } = setup();
    tabs.open(hub);
    tabs.router.push(session("s1"));
    expect(routes()).toEqual(["home", "session"]);
  });

  test("routes that differ only inside a nested field are different screens (#576)", () => {
    const { tabs, routes } = setup();
    const reader = (claudeSessionId: string): Route => ({
      name: "reader",
      target: { hostId: "h", claudeSessionId },
    });
    tabs.open(reader("a"));
    tabs.router.push(reader("b"));
    expect(tabs.active.router.current).toEqual(reader("b"));
    tabs.show(reader("a"));
    expect(routes()).toEqual(["home", "reader", "reader"]);
  });

  test("a ctrl or middle click on a link still opens a new tab (#576)", () => {
    const { tabs, routes } = setup();
    tabs.open(hub);
    tabs.open(costs);
    tabs.openNextInNewTab();
    tabs.router.push(hub);
    expect(routes()).toEqual(["home", "hub", "costs", "hub"]);
  });

  test("showing a screen focuses its tab, or opens one when none shows it (#576)", () => {
    const { tabs, routes } = setup();
    const terminal: Route = { name: "terminal", host: "h", terminalId: "t" };
    tabs.show(terminal);
    tabs.open(costs);
    tabs.show({ terminalId: "t", host: "h", name: "terminal" });
    expect(routes()).toEqual(["home", "terminal", "costs"]);
    expect(tabs.active.router.current).toEqual(terminal);
  });

  test("the new-tab button still adds a Home tab beside one that exists (#576)", () => {
    const { tabs, routes } = setup();
    tabs.open({ name: "home" });
    expect(routes()).toEqual(["home", "home"]);
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
