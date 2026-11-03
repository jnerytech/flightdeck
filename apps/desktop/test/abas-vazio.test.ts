import { describe, expect, test } from "bun:test";
import type { Route } from "../src/lib/router.ts";
import { Tabs } from "../src/lib/tabs.ts";
import { Workspace } from "../src/lib/workspace.ts";

const hub: Route = { name: "hub" };
const costs: Route = { name: "costs" };

function setup() {
  let n = 0;
  const newId = () => `t${++n}`;
  return { tabs: new Tabs({ name: "home" }, newId), newId };
}

describe("abas-vazio: the window may have no tab", () => {
  test("closing the last tab leaves none, and the navigation says it is on the start screen", () => {
    const { tabs } = setup();
    tabs.close(tabs.activeId);
    expect(tabs.tabs).toHaveLength(0);
    expect(tabs.router.current).toEqual({ name: "start" });
    expect(tabs.router.canBack).toBe(false);
    expect(tabs.router.canForward).toBe(false);
    tabs.router.back();
    tabs.router.forward();
    tabs.next();
    tabs.previous();
    tabs.goto(3);
    expect(tabs.tabs).toHaveLength(0);
  });

  test("any navigation from there opens a tab; reopen brings the closed one back", () => {
    const { tabs } = setup();
    tabs.close(tabs.activeId);
    tabs.openPreview(hub);
    expect(tabs.tabs.map((tab) => tab.router.current.name)).toEqual(["hub"]);
    expect(tabs.active.router.current).toEqual(hub);
    tabs.close(tabs.activeId);
    tabs.router.push(costs);
    expect(tabs.tabs.map((tab) => tab.router.current.name)).toEqual(["costs"]);
    tabs.close(tabs.activeId);
    expect(tabs.reopen()?.router.current).toEqual(costs);
  });

  test("the window with one area keeps no tab; the second area of a split goes away with its last tab", () => {
    const ws = new Workspace({ name: "home" });
    ws.tabs.close(ws.tabs.activeId);
    expect(ws.areas).toHaveLength(1);
    expect(ws.router.current).toEqual({ name: "start" });
    ws.router.push(hub);
    expect(ws.tabs.tabs).toHaveLength(1);
    ws.toggleSplit();
    expect(ws.areas).toHaveLength(2);
    ws.tabs.close(ws.tabs.activeId);
    expect(ws.areas).toHaveLength(1);
    expect(ws.split).toBeNull();
    expect(ws.focus).toBe(0);
    expect(ws.tabs.tabs).toHaveLength(1);
  });

  test("the empty window is kept and restored empty", () => {
    const ws = new Workspace({ name: "home" });
    ws.tabs.close(ws.tabs.activeId);
    const kept = JSON.parse(JSON.stringify(ws.snapshot()));
    expect(kept.areas).toEqual([{ tabs: [], active: 0 }]);
    const back = Workspace.restore(kept);
    expect(back.areas).toHaveLength(1);
    expect(back.tabs.tabs).toHaveLength(0);
    expect(back.router.current).toEqual({ name: "start" });
  });
});
