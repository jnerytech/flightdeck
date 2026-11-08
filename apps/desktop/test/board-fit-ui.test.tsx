import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle, settleMaybe } from "./wait.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { BoardView } = await import("../src/ui/BoardView.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/** A ResizeObserver whose callbacks the test fires with the width it wants. */
function fakeResizeObserver() {
  const saved = globalThis.ResizeObserver;
  const observers: Array<(width: number) => void> = [];
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      observers.push((width) =>
        callback([{ contentRect: { width } } as ResizeObserverEntry], this as ResizeObserver),
      );
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  return {
    resize: (width: number) =>
      act(async () => {
        for (const fire of observers) fire(width);
      }),
    restore: () => {
      globalThis.ResizeObserver = saved;
    },
  };
}

function setup(options: { width?: number } = {}) {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  (store as unknown as { update(p: object): void }).update({
    hosts: [
      {
        id: "h1",
        name: "alfa",
        url: "ws://x",
        token: "",
        status: "online",
        info: null,
        hostInfo: { daemonVersion: "x", features: [] },
        incompatibility: null,
        daemonUpdate: null,
        sessions: [],
      },
    ],
    projects: { h1: [{ id: "p1", name: "api", path: "/x/api" }] },
    cards: {},
  });
  store.hostCommand = (async (_hostId: string, type: string) =>
    type === "board.get" ? { project: { id: "p1", name: "api" }, cards: [] } : {}) as never;
  if (options.width !== undefined) store.boardWidth.set(options.width, false);
  const ro = fakeResizeObserver();
  render(
    <TContext.Provider value={store.i18n.t}>
      <BoardView
        store={store}
        hostId="h1"
        projectId="p1"
        onOpenCard={() => {}}
        onOpenSettings={() => {}}
      />
    </TContext.Provider>,
  );
  return { store, ...ro };
}

const grid = () => document.querySelector("[data-slot='board-columns']") as HTMLElement | null;
const columnsWidth = () => grid()?.style.gridAutoColumns;
const ready = () => settle(() => grid() !== null);

describe("board-fit-ui: the columns share the window until the person picks a width (#1030)", () => {
  test("before the board is measured, the columns have the default width", async () => {
    const { restore } = setup();
    await ready();
    expect(columnsWidth()).toBe("260px");
    restore();
  });

  test("a 992 px board gives five columns 187 px each, so none is cut", async () => {
    const { resize, restore } = setup();
    await ready();
    await resize(992);
    await settleMaybe(() => columnsWidth() === "187px");
    expect(columnsWidth()).toBe("187px");
    restore();
  });

  test("a wide board makes the columns wider, up to the limit, and a narrow one keeps the usual width and scrolls", async () => {
    const { resize, restore } = setup();
    await ready();
    const seen: Array<string | undefined> = [];
    for (const [board, want] of [
      [1700, "328px"],
      [3000, "520px"],
      // Under 640 px a narrow board shows one column at a time instead (#1198).
      [700, "260px"],
    ] as const) {
      await resize(board);
      await settleMaybe(() => columnsWidth() === want);
      seen.push(columnsWidth());
    }
    expect(seen).toEqual(["328px", "520px", "260px"]);
    restore();
  });

  test("a width the person chose is kept whatever the board measures", async () => {
    const { resize, restore } = setup({ width: 300 });
    await ready();
    await resize(992);
    expect(columnsWidth()).toBe("300px");
    restore();
  });

  test("the handle announces the width the columns have now", async () => {
    const { resize, restore } = setup();
    await ready();
    await resize(992);
    await settleMaybe(() => columnsWidth() === "187px");
    const handle = screen.getAllByRole("separator", { name: "Resize the columns" })[0];
    expect(handle?.getAttribute("aria-valuenow")).toBe("187");
    restore();
  });

  test("a column's head never wraps: its name gives way, and the count and + stay on its line", async () => {
    const { restore } = setup();
    await ready();
    const heads = [...document.querySelectorAll("[data-slot='board-columns'] .column-head")];
    expect(heads.length).toBe(5); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(heads.every((head) => head.classList.contains("flex-nowrap"))).toBe(true);
    restore();
  });
});
