import { describe, expect, test } from "bun:test";
import {
  openSwitcher,
  pickedId,
  stepSwitcher,
  TAB_ORDER_KEY,
  TabOrderController,
} from "../src/lib/tab-switcher.ts";
import { Tabs } from "../src/lib/tabs.ts";
import type { Platform } from "../src/platform/types.ts";

const names = (tabs: Tabs) => tabs.recent().map((tab) => tab.router.current.name);
const ids = (() => {
  let n = 0;
  return () => `t${n++}`;
})();

/** Tabs A, B, C opened in that order: three different screens. */
function abc() {
  const tabs = new Tabs({ name: "hub" }, ids);
  tabs.open({ name: "costs" });
  tabs.open({ name: "history", host: "h" } as never);
  return tabs;
}

describe("tab-mru: the tabs by how recently they were active (issue #148)", () => {
  test("opened A, B, C: the newest is first, then back to the oldest", () => {
    expect(names(abc())).toEqual(["history", "costs", "hub"]);
  });

  test("activating a tab brings it to the front and keeps the rest in order", () => {
    const tabs = abc();
    tabs.activate(tabs.tabs[0]?.id as string);
    expect(names(tabs)).toEqual(["hub", "history", "costs"]);
  });

  test("closing a tab removes it, and the one that takes over its place is the front", () => {
    const tabs = abc();
    tabs.close(tabs.activeId);
    expect(names(tabs)).toEqual(["costs", "hub"]);
  });

  test("a tab opened in the background joins at the back; a pinned tab is included", () => {
    const tabs = abc();
    const back = tabs.open({ name: "settings" }, { background: true });
    expect(names(tabs)).toEqual(["history", "costs", "hub", "settings"]);
    tabs.pin(back.id, true);
    expect(names(tabs)).toContain("settings");
    expect(tabs.recent()).toHaveLength(4);
  });

  test("next, previous and the number keys count as activations", () => {
    const tabs = abc();
    tabs.previous();
    expect(names(tabs)[0]).toBe("costs");
    tabs.goto(1);
    expect(names(tabs)[0]).toBe("hub");
  });

  test("a tab taken to the other area leaves the list, one adopted comes in front", () => {
    const tabs = abc();
    const other = new Tabs(null, ids);
    const moved = tabs.take(tabs.tabs[1]?.id as string);
    expect(names(tabs)).toEqual(["history", "hub"]);
    other.adopt(moved as never);
    expect(other.recent()).toHaveLength(1);
    tabs.adopt(other.take(moved?.id as string) as never);
    expect(names(tabs)[0]).toBe("costs");
  });

  test("restored tabs start with the active one first, then the strip's order", () => {
    const tabs = Tabs.restore(
      [
        { route: { name: "hub" }, pinned: false },
        { route: { name: "costs" }, pinned: false },
        { route: { name: "settings" }, pinned: false },
      ],
      1,
      ids,
    );
    expect(names(tabs)).toEqual(["costs", "hub", "settings"]);
  });
});

describe("tab-mru: the switcher while Ctrl is held (issue #148)", () => {
  const list = ["c", "b", "a"];

  test("it opens on the previous tab, or on the least recent one with Shift", () => {
    expect(pickedId(openSwitcher(list, 1) as never)).toBe("b");
    expect(pickedId(openSwitcher(list, -1) as never)).toBe("a");
  });

  test("each Tab goes one down and Shift one up, around the ends", () => {
    let state = openSwitcher(list, 1);
    state = stepSwitcher(state as never, 1);
    expect(pickedId(state)).toBe("a");
    state = stepSwitcher(state, 1);
    expect(pickedId(state)).toBe("c");
    state = stepSwitcher(state, -1);
    expect(pickedId(state)).toBe("a");
  });

  test("with fewer than two tabs there is nothing to switch to", () => {
    expect(openSwitcher(["a"], 1)).toBeNull();
    expect(openSwitcher([], -1)).toBeNull();
  });

  test("a tap lands on the previous tab, and a tap again comes back (A, B, C with C active)", () => {
    const tabs = abc();
    const tap = () => {
      const state = openSwitcher(
        tabs.recent().map((t) => t.id),
        1,
      );
      tabs.activate(pickedId(state as never));
    };
    tap();
    expect(tabs.active.router.current.name).toBe("costs");
    tap();
    expect(tabs.active.router.current.name).toBe("history");
    // Holding Ctrl and pressing Tab twice from C lands on A.
    let state = openSwitcher(
      tabs.recent().map((t) => t.id),
      1,
    );
    state = stepSwitcher(state as never, 1);
    tabs.activate(pickedId(state));
    expect(tabs.active.router.current.name).toBe("hub");
  });
});

describe("tab-mru: the order setting (issue #148)", () => {
  const storage = (initial?: string) => {
    const data = new Map<string, string>(initial ? [[TAB_ORDER_KEY, initial]] : []);
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      data,
    };
  };

  test("most recently used by default; the stored choice and only a valid one comes back", () => {
    expect(new TabOrderController(storage() as unknown as Platform["storage"]).value).toBe("mru");
    expect(
      new TabOrderController(storage("sequential") as unknown as Platform["storage"]).value,
    ).toBe("sequential");
    expect(
      new TabOrderController(storage("nonsense") as unknown as Platform["storage"]).value,
    ).toBe("mru");
  });

  test("setting it keeps it and tells the listeners", () => {
    const kept = storage();
    const controller = new TabOrderController(kept as unknown as Platform["storage"]);
    let told = 0;
    controller.subscribe(() => told++);
    controller.set("sequential");
    expect(controller.value).toBe("sequential");
    expect(kept.data.get(TAB_ORDER_KEY)).toBe("sequential");
    expect(told).toBe(1);
  });
});
