import { describe, expect, test } from "bun:test";
import { HostTabs, routeHost } from "../src/lib/host-tabs.ts";
import type { Route } from "../src/lib/router.ts";
import type { Tab } from "../src/lib/tabs.ts";

/**
 * Issue #644: each host keeps its own tabs, the shared screens stay at the left of every set, and
 * the switcher always shows the active tab's host. This is the state layer the shell is built on.
 */
const home: Route = { name: "home" };
const settings: Route = { name: "settings" };
const needsYou: Route = { name: "needs-you" };
const session = (host: string, id: string): Route => ({ name: "session", host, id });
const board = (host: string): Route => ({ name: "board", host, projectId: "p1" });
const terminal = (host: string): Route => ({ name: "terminal", host, terminalId: "x1" });
const overview = (host: string): Route => ({ name: "host", host });

/** A route as a short label: its name, then its host and id when it has them. */
function label(route: Route): string {
  const r = route as { name: string; host?: string; id?: string };
  return [r.name, r.host ? `@${r.host}` : "", r.id ? `#${r.id}` : ""].join("");
}

function fresh(stored: unknown = null, fallback: Route = home) {
  let n = 0;
  const tabs = HostTabs.restore(stored, () => `t${++n}`, fallback);
  const seen = { n: 0 };
  tabs.subscribe(() => void seen.n++);
  return { tabs, seen };
}

/** The row: the shared tabs, then the current host's (its focused area). */
function row(tabs: HostTabs): string[] {
  const own = tabs.workspace?.tabs.tabs ?? [];
  return [...tabs.shared.tabs, ...own].map((tab: Tab) => label(tab.router.current));
}

const where = (tabs: HostTabs) => ({
  host: tabs.hostId,
  onShared: tabs.onShared,
  current: label(tabs.router.current),
});

describe("host-tabs: the host a screen belongs to (#644)", () => {
  test("a host's own screens go to its set by id; cross-host screens, even filtered by a host, are shared", () => {
    expect([
      routeHost(session("A", "s1")),
      routeHost(terminal("B")),
      routeHost(overview("A")),
      routeHost({ name: "reader", target: { hostId: "C", claudeSessionId: "x" } }),
      routeHost({ name: "hub", host: "wsl" }),
      routeHost({ name: "costs", host: "A" }),
      routeHost({ name: "all-projects", host: "A" }),
      routeHost({ name: "teams", host: "A" }),
      routeHost(settings),
      routeHost(home),
    ]).toEqual(["A", "B", "A", "C", null, null, null, null, null, null]);
  });
});

describe("host-tabs: each host keeps its own tabs (#644)", () => {
  test("a fresh window opens its fallback: a shared screen with no host, or that host's set", () => {
    const shared = fresh();
    const host = fresh(null, overview("A"));
    expect([where(shared.tabs), row(shared.tabs), where(host.tabs), row(host.tabs)]).toEqual([
      { host: null, onShared: true, current: "home" },
      ["home"],
      { host: "A", onShared: false, current: "host@A" },
      ["host@A"],
    ]);
  });

  test("switching host swaps the row and restores that host's last active tab", () => {
    const { tabs } = fresh();
    tabs.switchHost("A");
    tabs.open(session("A", "s1"));
    tabs.open(board("A"));
    tabs.show(session("A", "s1"));
    tabs.switchHost("B");
    const onB = [where(tabs), row(tabs)];
    tabs.open(terminal("B"));
    tabs.switchHost("A");
    expect([...onB, where(tabs), row(tabs), tabs.tabCount("A"), tabs.tabCount("B")]).toEqual([
      { host: "B", onShared: false, current: "host@B" },
      ["home", "host@B"],
      { host: "A", onShared: false, current: "session@A#s1" },
      ["home", "host@A", "session@A#s1", "board@A"],
      3,
      2,
    ]);
  });

  test("opening another host's item switches the host and opens it in that host's set", () => {
    const { tabs } = fresh(null, overview("A"));
    tabs.router.push(session("B", "s9"));
    const first = [where(tabs), row(tabs), tabs.tabCount("A")];
    // Back on A, the same link goes to the tab B's set already has for it.
    tabs.switchHost("A");
    tabs.router.push(session("B", "s9"));
    expect([...first, where(tabs), tabs.tabCount("B"), tabs.tabCount("A")]).toEqual([
      { host: "B", onShared: false, current: "session@B#s9" },
      ["session@B#s9"],
      1,
      { host: "B", onShared: false, current: "session@B#s9" },
      1,
      1,
    ]);
  });

  test("a shared screen opens as a pinned shared tab, keeps the switcher on the last host, and stays across hosts", () => {
    const { tabs } = fresh(null, overview("A"));
    tabs.router.push(settings);
    const onSettings = where(tabs);
    tabs.switchHost("B");
    expect([
      onSettings,
      where(tabs),
      row(tabs),
      tabs.shared.tabs.every((tab) => tab.pinned),
    ]).toEqual([
      { host: "A", onShared: true, current: "settings" },
      { host: "B", onShared: false, current: "host@B" },
      ["settings", "host@B"],
      true,
    ]);
  });

  test("on a shared tab, a link to another shared screen goes there in place, and a host's link goes to that host", () => {
    const { tabs } = fresh();
    tabs.router.push(needsYou);
    const inPlace = [where(tabs), row(tabs)];
    tabs.router.push(session("A", "s1"));
    expect([...inPlace, where(tabs), row(tabs)]).toEqual([
      { host: null, onShared: true, current: "needs-you" },
      ["needs-you"],
      { host: "A", onShared: false, current: "session@A#s1" },
      ["needs-you", "session@A#s1"],
    ]);
  });

  test("a tab opened in the background for another host does not switch the host", () => {
    const { tabs } = fresh(null, overview("A"));
    tabs.open(terminal("B"), { background: true });
    tabs.open(settings, { background: true });
    expect([where(tabs), tabs.tabCount("B"), row(tabs)]).toEqual([
      { host: "A", onShared: false, current: "host@A" },
      1,
      ["settings", "host@A"],
    ]);
  });

  test("a sidebar preview of another host's screen switches the host and opens as a preview", () => {
    const { tabs } = fresh(null, overview("A"));
    tabs.openPreview(board("B"));
    tabs.openPreview(settings);
    const preview = tabs.workspace?.tabs.tabs.find((tab) => tab.preview);
    expect([where(tabs), label(preview?.router.current ?? home), row(tabs)]).toEqual([
      { host: "B", onShared: true, current: "settings" },
      "board@B",
      ["settings", "board@B"],
    ]);
  });

  test("Ctrl+Tab and Ctrl+1..9 go over the shared tabs and the current host's, and activate finds either", () => {
    const { tabs } = fresh();
    tabs.switchHost("A");
    tabs.open(session("A", "s1"));
    const steps: string[] = [];
    for (const move of ["next", "next", "previous", "previous"] as const) {
      tabs[move]();
      steps.push(label(tabs.router.current));
    }
    tabs.goto(1);
    steps.push(where(tabs).current, String(tabs.onShared));
    tabs.goto(9);
    steps.push(label(tabs.router.current));
    const shared = tabs.shared.tabs[0]?.id ?? "no shared tab";
    tabs.activate(shared);
    steps.push(String(tabs.onShared), String(tabs.activeId === shared));
    const own = tabs.workspace?.tabs.tabs[0]?.id ?? "no host tab";
    tabs.activate(own);
    steps.push(String(tabs.onShared), String(tabs.activeId === own));
    expect(steps).toEqual([
      "home",
      "host@A",
      "home",
      "session@A#s1",
      "home",
      "true",
      "session@A#s1",
      "true",
      "true",
      "false",
      "true",
    ]);
  });
});

describe("host-tabs: closing and removing (#644)", () => {
  test("closing a host's last tab shows that host's Overview, once", () => {
    const { tabs, seen } = fresh(null, session("A", "s1"));
    const only = tabs.activeId;
    tabs.close(only);
    const after = seen.n;
    expect([where(tabs), row(tabs), tabs.activeId !== only, after < 10]).toEqual([
      { host: "A", onShared: false, current: "host@A" },
      ["host@A"],
      true,
      true,
    ]);
  });

  test("closing the last shared tab goes back to the host's active tab; with no host, to the start", () => {
    const { tabs } = fresh(null, overview("A"));
    tabs.router.push(settings);
    tabs.close(tabs.activeId);
    const back = [where(tabs), row(tabs)];
    const lone = fresh();
    lone.tabs.close(lone.tabs.activeId);
    expect([...back, where(lone.tabs), row(lone.tabs)]).toEqual([
      { host: "A", onShared: false, current: "host@A" },
      ["host@A"],
      { host: null, onShared: false, current: "start" },
      [],
    ]);
  });

  test("removing a host drops its set; the switcher moves to another host, or to none and the start", () => {
    const { tabs } = fresh(null, overview("A"));
    tabs.open(session("A", "s1"));
    tabs.switchHost("B");
    tabs.removeHost("B");
    const one = [where(tabs), tabs.tabCount("B")];
    tabs.removeHost("A");
    expect([...one, where(tabs), tabs.tabCount("A"), row(tabs)]).toEqual([
      { host: "A", onShared: false, current: "session@A#s1" },
      0,
      { host: null, onShared: false, current: "start" },
      0,
      [],
    ]);
  });

  test("every change is announced to the subscribers", () => {
    const { tabs, seen } = fresh(null, overview("A"));
    const before = seen.n;
    tabs.switchHost("B");
    const switched = seen.n;
    tabs.router.push(session("B", "s2"));
    expect([switched > before, seen.n > switched, tabs.version > 0]).toEqual([true, true, true]);
  });
});

describe("host-tabs: persistence across restarts (#644)", () => {
  test("the sets, their order, their active tabs and the current host come back", () => {
    const { tabs } = fresh();
    tabs.switchHost("A");
    tabs.open(session("A", "s1"));
    tabs.open(board("A"));
    tabs.show(session("A", "s1"));
    tabs.open({ name: "preview", url: "http://127.0.0.1:5173", title: "app" });
    tabs.switchHost("B");
    tabs.open(terminal("B"));
    tabs.router.push(settings);
    const stored = JSON.parse(JSON.stringify(tabs.snapshot()));
    const back = fresh(stored).tabs;
    const onB = [where(back), row(back)];
    back.switchHost("A");
    expect([stored.v, ...onB, where(back), row(back)]).toEqual([
      2,
      { host: "B", onShared: true, current: "settings" },
      ["home", "settings", "host@B", "terminal@B"],
      // The preview of a card's app is not kept: its address may belong to another program.
      { host: "A", onShared: false, current: "session@A#s1" },
      ["home", "settings", "host@A", "session@A#s1", "board@A"],
    ]);
  });

  test("today's single tab list is split into per-host sets by each tab's host", () => {
    const v1 = {
      v: 1,
      areas: [
        {
          tabs: [
            { route: home, pinned: true },
            { route: session("A", "s1"), pinned: false },
            { route: board("B"), pinned: false },
            { route: settings, pinned: false },
            { route: terminal("A"), pinned: true },
          ],
          active: 2,
        },
        { tabs: [{ route: { name: "history", host: "B" }, pinned: false }], active: 0 },
      ],
      split: "vertical",
      focus: 0,
      fraction: 0.5,
    };
    const { tabs } = fresh(v1);
    const onB = [where(tabs), row(tabs), tabs.workspace?.split ?? "one area"];
    tabs.switchHost("A");
    expect([...onB, where(tabs), row(tabs), tabs.shared.tabs.every((tab) => tab.pinned)]).toEqual([
      { host: "B", onShared: false, current: "board@B" },
      ["home", "settings", "board@B", "history@B"],
      "one area",
      { host: "A", onShared: false, current: "session@A#s1" },
      ["home", "settings", "terminal@A", "session@A#s1"],
      true,
    ]);
  });

  test("a v1 window on a shared tab keeps it active, with the first host seen as the switcher's", () => {
    const { tabs } = fresh({
      v: 1,
      areas: [
        {
          tabs: [
            { route: session("A", "s1"), pinned: false },
            { route: needsYou, pinned: false },
          ],
          active: 1,
        },
      ],
      split: null,
      focus: 0,
      fraction: 0.5,
    });
    expect([where(tabs), row(tabs)]).toEqual([
      { host: "A", onShared: true, current: "needs-you" },
      ["needs-you", "session@A#s1"],
    ]);
  });

  test("something unusable gives a fresh window, and a tab filed under the wrong host is dropped", () => {
    const junk = ["nope", 7, { v: 9 }, { v: 2, hosts: "x", shared: null }].map((stored) =>
      row(fresh(stored).tabs).join(","),
    );
    const wrong = fresh({
      v: 2,
      shared: { tabs: [{ route: { name: "unknown-screen" }, pinned: true }], active: 0 },
      hosts: {
        A: {
          v: 1,
          areas: [{ tabs: [{ route: session("B", "x"), pinned: false }], active: 0 }],
          split: null,
          focus: 0,
          fraction: 0.5,
        },
      },
      host: "A",
      onShared: false,
    }).tabs;
    expect([...junk, where(wrong), row(wrong), wrong.tabCount("B")]).toEqual([
      "home",
      "home",
      "home",
      "home",
      { host: "A", onShared: false, current: "host@A" },
      ["host@A"],
      0,
    ]);
  });
});
