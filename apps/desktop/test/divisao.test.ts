import { describe, expect, test } from "bun:test";
import type { Route } from "../src/lib/router.ts";
import { FRACTION_MAX, FRACTION_MIN, Workspace } from "../src/lib/workspace.ts";

const hub: Route = { name: "hub" };
const costs: Route = { name: "costs" };

function setup() {
  let n = 0;
  const ws = new Workspace({ name: "home" }, () => `t${++n}`);
  const seen: number[] = [];
  ws.subscribe(() => void seen.push(1));
  const ids = (area: number) => ws.areas[area]?.tabs.map((tab) => tab.id);
  return { ws, seen, ids };
}

describe("divisao", () => {
  test("starts with one area, not split, focused", () => {
    const { ws, ids } = setup();
    expect(ws.areas).toHaveLength(1);
    expect(ws.split).toBeNull();
    expect(ws.focus).toBe(0);
    expect(ids(0)).toEqual(["t1"]);
    expect(ws.tabs).toBe(ws.areas[0] as never);
  });

  test("Ctrl+\\ splits: a second area shows the same screen and takes the focus; again, it joins", () => {
    const { ws, ids } = setup();
    ws.router.push(hub);
    ws.toggleSplit();
    expect(ws.split).toBe("vertical");
    expect(ws.areas).toHaveLength(2);
    expect(ws.areas[1]?.router.current).toEqual(hub);
    expect(ws.focus).toBe(1);
    expect(ws.tabs).toBe(ws.areas[1] as never);
    ws.areas[1]?.open(costs);
    ws.toggleSplit();
    expect(ws.split).toBeNull();
    expect(ws.areas).toHaveLength(1);
    expect(ws.focus).toBe(0);
    expect(ids(0)).toHaveLength(3);
    expect(ws.areas[0]?.tabs.map((tab) => tab.router.current.name)).toEqual([
      "hub",
      "hub",
      "costs",
    ]);
  });

  test("it can split horizontally, and the direction can change while split", () => {
    const { ws } = setup();
    ws.toggleSplit("horizontal");
    expect(ws.split).toBe("horizontal");
    ws.setOrientation("vertical");
    expect(ws.split).toBe("vertical");
    ws.toggleSplit();
    ws.setOrientation("horizontal");
    expect(ws.split).toBeNull();
  });

  test("the navigation follows the focused area", () => {
    const { ws } = setup();
    ws.toggleSplit();
    ws.router.push(hub);
    expect(ws.areas[1]?.router.current).toEqual(hub);
    expect(ws.areas[0]?.router.current).toEqual({ name: "home" });
    ws.focusArea(0);
    expect(ws.router.current).toEqual({ name: "home" });
    ws.router.push(costs);
    expect(ws.areas[0]?.router.current).toEqual(costs);
    expect(ws.areas[1]?.router.current).toEqual(hub);
  });

  test("a tab moves to the other area and is active there; the area it leaves empty closes", () => {
    const { ws, ids } = setup();
    ws.router.push(hub);
    ws.areas[0]?.open(costs);
    expect(ids(0)).toEqual(["t1", "t2"]);
    const moved = ws.moveToOtherArea("t2");
    expect(ws.split).toBe("vertical");
    expect(moved?.id).toBe("t2");
    expect(ids(0)).toEqual(["t1"]);
    expect(ids(1)).toEqual(["t2"]);
    expect(ws.areas[1]?.activeId).toBe("t2");
    expect(ws.focus).toBe(1);
    ws.moveToOtherArea("t2");
    expect(ids(0)).toEqual(["t1", "t2"]);
    expect(ws.areas).toHaveLength(1);
    expect(ws.split).toBeNull();
    expect(ws.moveToOtherArea("nope")).toBeNull();
  });

  test("a tab taken keeps its history and is not remembered as closed", () => {
    const { ws } = setup();
    ws.router.push(hub);
    ws.router.push(costs);
    ws.toggleSplit();
    const moved = ws.moveToOtherArea(ws.areas[0]?.activeId as string);
    expect(moved?.router.canBack).toBe(true);
    expect(ws.tabs.reopen()).toBeNull();
  });

  test("the divider's share is kept between 20% and 80%", () => {
    const { ws } = setup();
    ws.setFraction(0.35);
    expect(ws.fraction).toBe(0.35);
    ws.setFraction(0.01);
    expect(ws.fraction).toBe(FRACTION_MIN);
    ws.setFraction(0.99);
    expect(ws.fraction).toBe(FRACTION_MAX);
  });

  test("listeners hear about any area, the split, the focus and the divider", () => {
    const { ws, seen } = setup();
    ws.toggleSplit();
    const after = seen.length;
    expect(after).toBeGreaterThan(0);
    ws.areas[0]?.open(hub);
    ws.focusArea(0);
    ws.setFraction(0.4);
    ws.setOrientation("horizontal");
    expect(seen.length).toBeGreaterThanOrEqual(after + 4);
    expect(ws.version).toBeGreaterThanOrEqual(seen.length);
  });
});
