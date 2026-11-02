import { describe, expect, test } from "bun:test";
import type { Route } from "../src/lib/router.ts";
import { CLOSED_LIMIT, Tabs } from "../src/lib/tabs.ts";

const hub: Route = { name: "hub" };
const costs: Route = { name: "costs" };
const settings: Route = { name: "settings" };
const session = (id: string): Route => ({ name: "session", host: "h", id });

function setup() {
  let n = 0;
  const tabs = new Tabs({ name: "home" }, () => `t${++n}`);
  const seen: number[] = [];
  tabs.subscribe(() => void seen.push(1));
  const routes = () => tabs.tabs.map((tab) => tab.router.current.name);
  const ids = () => tabs.tabs.map((tab) => tab.id);
  return { tabs, seen, routes, ids };
}

describe("abas", () => {
  test("starts with one tab on the initial route, active", () => {
    const { tabs, ids } = setup();
    expect(ids()).toEqual(["t1"]);
    expect(tabs.activeId).toBe("t1");
    expect(tabs.router.current).toEqual({ name: "home" });
  });

  test("open adds a tab after the active one and activates it; in the background it stays put", () => {
    const { tabs, ids, routes } = setup();
    tabs.open(hub);
    tabs.open(costs, { background: true });
    expect(ids()).toEqual(["t1", "t2", "t3"]);
    expect(routes()).toEqual(["home", "hub", "costs"]);
    expect(tabs.activeId).toBe("t2");
    tabs.activate("t1");
    tabs.open(settings);
    expect(ids()).toEqual(["t1", "t4", "t2", "t3"]);
  });

  test("a normal navigation changes the active tab only, each tab keeps its own history", () => {
    const { tabs, routes } = setup();
    tabs.open(hub);
    tabs.router.push(session("a"));
    expect(routes()).toEqual(["home", "session"]);
    expect(tabs.router.canBack).toBe(true);
    tabs.router.back();
    expect(tabs.router.current).toEqual(hub);
    tabs.activate("t1");
    expect(tabs.router.canBack).toBe(false);
    expect(tabs.router.current).toEqual({ name: "home" });
  });

  test("the navigation facade tells its listeners about a push and about a tab switch", () => {
    const { tabs, seen } = setup();
    const heard: number[] = [];
    tabs.router.subscribe(() => void heard.push(1));
    tabs.open(hub);
    tabs.router.push(costs);
    tabs.activate("t1");
    expect(heard.length).toBeGreaterThanOrEqual(3);
    expect(seen.length).toBeGreaterThanOrEqual(3);
  });

  test("close activates the neighbour; the last tab is replaced by a new home", () => {
    const { tabs, ids } = setup();
    tabs.open(hub);
    tabs.open(costs);
    tabs.close("t3");
    expect(tabs.activeId).toBe("t2");
    tabs.close("t1");
    expect(ids()).toEqual(["t2"]);
    tabs.close("t2");
    expect(ids()).toEqual(["t4"]);
    expect(tabs.router.current).toEqual({ name: "home" });
  });

  test("closing a tab that is not active keeps the active one", () => {
    const { tabs, ids } = setup();
    tabs.open(hub);
    tabs.close("t1");
    expect(ids()).toEqual(["t2"]);
    expect(tabs.activeId).toBe("t2");
  });

  test("reopen brings back the last closed tab where it was, with its route; nothing to reopen is null", () => {
    const { tabs, ids, routes } = setup();
    expect(tabs.reopen()).toBeNull();
    tabs.open(hub);
    tabs.open(costs);
    tabs.close("t2");
    tabs.close("t3");
    expect(routes()).toEqual(["home"]);
    const back = tabs.reopen();
    expect(back?.router.current).toEqual(costs);
    expect(tabs.activeId).toBe(back?.id as string);
    tabs.reopen();
    expect(routes()).toEqual(["home", "hub", "costs"]);
    expect(tabs.router.current).toEqual(hub);
    expect(ids()).toHaveLength(3);
  });

  test("the closed stack keeps the last 20", () => {
    const { tabs } = setup();
    for (let i = 0; i < CLOSED_LIMIT + 5; i++) tabs.open(session(String(i)));
    for (const tab of [...tabs.tabs].slice(1)) tabs.close(tab.id);
    let reopened = 0;
    while (tabs.reopen()) reopened++;
    expect(reopened).toBe(CLOSED_LIMIT);
  });

  test("next and previous wrap around; goto N jumps, and 9 is the last tab", () => {
    const { tabs, ids } = setup();
    tabs.open(hub);
    tabs.open(costs);
    tabs.next();
    expect(tabs.activeId).toBe("t1");
    tabs.previous();
    expect(tabs.activeId).toBe("t3");
    tabs.goto(2);
    expect(tabs.activeId).toBe("t2");
    tabs.goto(9);
    expect(tabs.activeId).toBe(ids().at(-1) as string);
    tabs.goto(5);
    expect(tabs.activeId).toBe(ids().at(-1) as string);
  });

  test("pinned tabs go to the left, in their order; unpinning sends it back after them", () => {
    const { tabs, ids } = setup();
    tabs.open(hub);
    tabs.open(costs);
    tabs.pin("t3", true);
    tabs.pin("t2", true);
    expect(ids()).toEqual(["t3", "t2", "t1"]);
    expect(tabs.tabs.map((t) => t.pinned)).toEqual([true, true, false]);
    tabs.pin("t3", false);
    expect(ids()).toEqual(["t2", "t3", "t1"]);
  });

  test("move reorders inside its own group: a pinned tab never crosses an unpinned one", () => {
    const { tabs, ids } = setup();
    tabs.open(hub);
    tabs.open(costs);
    tabs.pin("t1", true);
    tabs.move("t2", 2);
    expect(ids()).toEqual(["t1", "t3", "t2"]);
    tabs.move("t2", 0);
    expect(ids()).toEqual(["t1", "t2", "t3"]);
    tabs.move("t1", 2);
    expect(ids()).toEqual(["t1", "t2", "t3"]);
  });

  test("shift moves a tab one place inside its group, and canShift is off at the group's ends", () => {
    const { tabs, ids } = setup();
    tabs.open(hub);
    tabs.open(costs);
    tabs.open(settings);
    tabs.pin("t1", true);
    expect(ids()).toEqual(["t1", "t2", "t3", "t4"]);
    expect(tabs.canShift("t1", -1)).toBe(false);
    expect(tabs.canShift("t1", 1)).toBe(false);
    expect(tabs.canShift("t2", -1)).toBe(false);
    expect(tabs.canShift("t2", 1)).toBe(true);
    expect(tabs.canShift("t4", 1)).toBe(false);
    expect(tabs.canShift("t4", -1)).toBe(true);
    expect(tabs.canShift("nope", 1)).toBe(false);
    tabs.shift("t2", 1);
    expect(ids()).toEqual(["t1", "t3", "t2", "t4"]);
    tabs.shift("t4", -1);
    expect(ids()).toEqual(["t1", "t3", "t4", "t2"]);
    tabs.shift("t3", -1);
    expect(ids()).toEqual(["t1", "t3", "t4", "t2"]);
    tabs.shift("t2", 1);
    expect(ids()).toEqual(["t1", "t3", "t4", "t2"]);
    tabs.shift("nope", 1);
    expect(ids()).toEqual(["t1", "t3", "t4", "t2"]);
  });

  test("activating a tab that does not exist changes nothing", () => {
    const { tabs, seen } = setup();
    tabs.activate("nope");
    tabs.close("nope");
    tabs.pin("nope", true);
    tabs.move("nope", 0);
    expect(tabs.activeId).toBe("t1");
    expect(seen).toEqual([]);
  });

  test("a pinned tab closed comes back pinned, among the pinned ones", () => {
    const { tabs, ids } = setup();
    tabs.open(hub);
    tabs.open(costs);
    tabs.pin("t3", true);
    tabs.pin("t2", true);
    tabs.close("t3");
    const back = tabs.reopen();
    expect(back?.pinned).toBe(true);
    expect(ids().slice(0, 2).sort()).toEqual(["t2", back?.id as string].sort());
    expect(ids().at(-1)).toBe("t1");
  });

  describe("preview tabs", () => {
    test("the first tab is a preview; a single click replaces it, a tab you worked in is never replaced", () => {
      const { tabs, ids, routes } = setup();
      expect(tabs.active.preview).toBe(true);
      tabs.openPreview(hub);
      expect(ids()).toEqual(["t1"]);
      expect(routes()).toEqual(["hub"]);
      tabs.commit("t1");
      expect(tabs.active.preview).toBe(false);
      tabs.openPreview(costs);
      expect(ids()).toEqual(["t1", "t2"]);
      expect(routes()).toEqual(["hub", "costs"]);
      expect(tabs.activeId).toBe("t2");
      expect(tabs.active.preview).toBe(true);
      tabs.openPreview(settings);
      expect(ids()).toEqual(["t1", "t2"]);
      expect(routes()).toEqual(["hub", "settings"]);
    });

    test("a preview elsewhere is reused and brought to the front; pinning or committing keeps it", () => {
      const { tabs, ids, routes } = setup();
      tabs.commit("t1");
      tabs.openPreview(costs);
      tabs.activate("t1");
      tabs.openPreview(settings);
      expect(ids()).toEqual(["t1", "t2"]);
      expect(routes()).toEqual(["home", "settings"]);
      expect(tabs.activeId).toBe("t2");
      tabs.pin("t2", true);
      expect(tabs.tabs.find((tab) => tab.id === "t2")?.preview).toBe(false);
      tabs.openPreview(hub);
      expect(ids()).toEqual(["t2", "t3", "t1"]);
      expect(routes()).toEqual(["settings", "hub", "home"]);
    });

    test("a ctrl/middle click (open next in a new tab) makes a regular tab, not a preview", () => {
      const { tabs, ids } = setup();
      tabs.openNextInNewTab();
      tabs.openPreview(hub);
      expect(ids()).toEqual(["t1", "t2"]);
      expect(tabs.active.preview).toBe(false);
      expect(tabs.tabs[0]?.preview).toBe(true);
    });

    test("open() makes a regular tab and commit tells the listeners only when it changes something", () => {
      const { tabs, seen } = setup();
      expect(tabs.open(hub).preview).toBe(false);
      const before = seen.length;
      tabs.commit("t2");
      expect(seen.length).toBe(before);
      tabs.commit("t1");
      expect(seen.length).toBe(before + 1);
    });

    test("restore keeps which tabs are previews", () => {
      const restored = Tabs.restore(
        [
          { route: hub, pinned: false, preview: false },
          { route: costs, pinned: false, preview: true },
        ],
        1,
      );
      expect(restored.tabs.map((tab) => tab.preview)).toEqual([false, true]);
    });
  });
});
