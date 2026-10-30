import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { HOSTS_KEY } from "../src/lib/hosts.ts";
import type { Route } from "../src/lib/router.ts";
import { WORKSPACE_KEY, Workspace } from "../src/lib/workspace.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, render, within, waitFor } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const hub: Route = { name: "hub" };
const costs: Route = { name: "costs" };
const through = (ws: Workspace, newId?: () => string) =>
  Workspace.restore(JSON.parse(JSON.stringify(ws.snapshot())), newId);
const shape = (ws: Workspace) =>
  ws.areas.map((area) => ({
    tabs: area.tabs.map((tab): [string, boolean] => [tab.router.current.name, tab.pinned]),
    active: area.tabs.findIndex((tab) => tab.id === area.activeId),
  }));

describe("persistencia-abas", () => {
  test("tabs, pins, the active tab, the split, the focus and the divider come back", () => {
    const ws = new Workspace();
    ws.router.push(hub);
    ws.tabs.open(costs);
    ws.tabs.pin(ws.tabs.activeId, true);
    ws.toggleSplit("horizontal");
    ws.tabs.open({ name: "settings" });
    ws.focusArea(0);
    ws.setFraction(0.3);
    const back = through(ws);
    expect(shape(back)).toEqual(shape(ws));
    expect(back.split).toBe("horizontal");
    expect(back.focus).toBe(0);
    expect(back.fraction).toBe(0.3);
    expect(back.tabs.router.current).toEqual(ws.tabs.router.current);
  });

  test("only the screen of a tab is kept, not its history", () => {
    const ws = new Workspace();
    ws.router.push(hub);
    ws.router.push(costs);
    const back = through(ws);
    expect(back.router.current).toEqual(costs);
    expect(back.router.canBack).toBe(false);
  });

  test("the host form, which can hold a token, is never kept", () => {
    const ws = new Workspace();
    ws.router.push({
      name: "add-host",
      draft: { name: "x", url: "ws://h", token: "SEGREDO-123" },
    } as unknown as Route);
    ws.tabs.open(costs);
    const text = JSON.stringify(ws.snapshot());
    expect(text).not.toContain("SEGREDO-123");
    expect(shape(through(ws))[0]?.tabs).toEqual([["costs", false]]);
  });

  test("what cannot be read gives a fresh window; bad tabs and numbers are mended", () => {
    const fresh = (stored: unknown) => shape(Workspace.restore(stored));
    const home = [{ tabs: [["home", false]] as [string, boolean][], active: 0 }];
    expect(fresh(null)).toEqual(home);
    expect(fresh("x")).toEqual(home);
    expect(fresh({ v: 2 })).toEqual(home);
    expect(fresh({ v: 1, areas: "no" })).toEqual(home);
    expect(fresh({ v: 1, areas: [] })).toEqual(home);
    expect(
      fresh({ v: 1, areas: [{ tabs: [{ route: { name: "bogus" }, pinned: false }], active: 0 }] }),
    ).toEqual(home);
    const mended = Workspace.restore({
      v: 1,
      areas: [
        {
          tabs: [
            { route: { name: "bogus" }, pinned: false },
            { route: costs, pinned: true },
            { route: hub, pinned: false },
          ],
          active: 9,
        },
      ],
      split: "vertical",
      focus: 1,
      fraction: 7,
    });
    expect(shape(mended)).toEqual([
      {
        tabs: [
          ["costs", true],
          ["hub", false],
        ],
        active: 0,
      },
    ]);
    expect(mended.split).toBeNull();
    expect(mended.focus).toBe(0);
    expect(mended.fraction).toBe(0.8);
  });

  test("a stored split with two usable areas stays split, with the focus where it was", () => {
    const area = (route: Route) => ({ tabs: [{ route, pinned: false }], active: 0 });
    const ws = Workspace.restore({
      v: 1,
      areas: [area(hub), area(costs)],
      split: "vertical",
      focus: 1,
      fraction: 0.4,
    });
    expect(ws.areas).toHaveLength(2);
    expect(ws.split).toBe("vertical");
    expect(ws.focus).toBe(1);
  });

  test("the store keeps the window as it changes and restores it on the next start", async () => {
    const mem = memoryPlatform(false, "pt-BR");
    const first = new AppStore(mem.platform);
    first.tabs.open(costs);
    first.workspace.toggleSplit();
    expect(JSON.parse(mem.items.get(WORKSPACE_KEY) ?? "null")?.split).toBe("vertical");
    const second = new AppStore(mem.platform);
    expect(second.workspace.split).toBe("vertical");
    expect(second.workspace.areas).toHaveLength(2);
    expect(second.workspace.areas[0]?.tabs.map((tab) => tab.router.current.name)).toEqual([
      "home",
      "costs",
    ]);
  });

  test("a tab of a host that is not connected yet comes back saying Conectando a <host>…", async () => {
    const mem = memoryPlatform(false, "pt-BR");
    const first = new AppStore(mem.platform, { baseDelayMs: 10_000, maxDelayMs: 10_000 });
    const hostId = await first.addHost({ name: "pc", url: "ws://127.0.0.1:9/v1/ws", token: "t" });
    first.tabs.open({ name: "history", host: hostId });
    first.dispose();
    expect(mem.items.get(HOSTS_KEY)).toContain("pc");
    const second = new AppStore(mem.platform, { baseDelayMs: 10_000, maxDelayMs: 10_000 });
    render(<App store={second} />);
    await act(async () => {});
    await waitFor(() => expect(screen.queryByText("Conectando a pc…")).not.toBeNull());
    expect(second.workspace.tabs.tabs).toHaveLength(2);
    second.dispose();
  });
});
