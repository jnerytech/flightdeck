import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle, settleMaybe } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { BoardView } = await import("../src/ui/BoardView.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * Issue #1198 (round 6 of #168): every card was two Tab stops, so reaching Done took ~35 presses,
 * and at 640 and 390 the board showed two columns of five. The board is one Tab stop: the arrows
 * move between its cards, `s` starts the focused card and `m` shows its actions; a narrow board
 * shows one column at a time, picked from a row of buttons with each column's count.
 */
const host = {
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
};

const card = (id: string, column: string, position: number) => ({
  id,
  projectId: "p1",
  title: id,
  description: `about ${id}`,
  column,
  position,
  createdAt: `2026-11-04T10:0${position}:00Z`,
  waitingOn: [],
  blocking: [],
  branch: null,
  worktreePath: null,
  sessionId: null,
  sessionStatus: null,
  queued: false,
});

const CARDS = [
  card("A", "backlog", 1),
  card("B", "backlog", 2),
  card("D", "in_progress", 1),
  card("E", "done", 1),
];

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

function setup(language: "en" | "pt-BR" = "en") {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const internals = store as unknown as { update(p: object): void };
  internals.update({ hosts: [host] });
  internals.update({
    cards: Object.fromEntries(CARDS.map((c) => [`h1/${c.id}`, c])),
  });
  const commands: Array<[string, unknown]> = [];
  store.hostCommand = (async (_hostId: string, type: string, payload: unknown) => {
    commands.push([type, payload]);
    if (type === "board.get") return { project: { id: "p1", name: "api" }, cards: [] };
    return {};
  }) as never;
  const ro = fakeResizeObserver();
  render(
    <BoardView
      store={store}
      hostId="h1"
      projectId="p1"
      onOpenCard={() => {}}
      onOpenSettings={() => {}}
    />,
  );
  return { store, commands, ...ro };
}

/** The card buttons a Tab press can land on, by the card they belong to. */
const tabStops = () =>
  [...document.querySelectorAll<HTMLButtonElement>("[data-slot='board-columns'] li button")]
    .filter((b) => b.tabIndex === 0)
    .map((b) => b.closest("li")?.getAttribute("data-card") ?? "");
const title = (id: string) =>
  document.querySelector<HTMLButtonElement>(`li[data-card="${id}"] [data-card-open]`);
const focused = () => document.activeElement?.closest("li")?.getAttribute("data-card") ?? "";
const press = (key: string, init: object = {}) =>
  act(async () => {
    fireEvent.keyDown(document.activeElement as Element, { key, ...init });
  });
const ready = () => settle(() => title("A") !== null);
const shown = (column: string) =>
  document.querySelector<HTMLElement>(`[data-column="${column}"]`)?.hidden === false;

describe("board-keys-ui: the board is one Tab stop, and the arrows move between its cards (#1198)", () => {
  test("only the first card's title is a Tab stop; the cards' menus are not", async () => {
    const { restore } = setup();
    await ready();
    expect(tabStops()).toEqual(["A"]);
    restore();
  });

  test("the arrows go to the next card, skipping empty columns, and the Tab stop follows", async () => {
    const { restore } = setup();
    await ready();
    title("A")?.focus();
    const path = [focused()];
    for (const key of ["ArrowDown", "ArrowRight", "ArrowRight", "ArrowLeft"]) {
      await press(key);
      path.push(focused());
    }
    expect(path).toEqual(["A", "B", "D", "E", "D"]);
    expect(tabStops()).toEqual(["D"]);
    restore();
  });

  test("the card's title says the board's keys", async () => {
    const { restore } = setup();
    await ready();
    const hint = document.getElementById(title("A")?.getAttribute("aria-describedby") ?? "");
    expect(hint?.textContent ?? "").toContain("S starts it and M shows its actions");
    restore();
  });

  test("s starts the focused card, but s after g is the go-to chord's", async () => {
    const { restore } = setup();
    await ready();
    title("A")?.focus();
    await press("g");
    await press("s");
    const afterChord = screen.queryByRole("dialog") !== null;
    await press("s");
    await settleMaybe(() => screen.queryByRole("dialog") !== null);
    expect([afterChord, screen.queryByRole("dialog") !== null]).toEqual([false, true]);
    restore();
  });

  test("m shows the focused card's actions, with its moves", async () => {
    const { restore } = setup();
    await ready();
    title("A")?.focus();
    await press("m");
    await settleMaybe(() => screen.queryByRole("menuitem", { name: "Move to Done" }) !== null);
    expect(screen.queryByRole("menuitem", { name: "Move to Done" })).not.toBeNull();
    restore();
  });
});

describe("board-keys-ui: a narrow board shows one column at a time (#1198)", () => {
  for (const [language, group, done] of [
    ["en", "Columns", "Done, 1 card"],
    ["pt-BR", "Colunas", "Concluído, 1 card"],
  ] as const) {
    test(`${language}: at 390 a row of buttons with counts picks the column`, async () => {
      const { resize, restore } = setup(language);
      await ready();
      await resize(390);
      await settleMaybe(() => screen.queryByRole("group", { name: group }) !== null);
      const switcher = screen.queryByRole("group", { name: group });
      expect(switcher).not.toBeNull();
      const before = [shown("backlog"), shown("done")];
      await act(async () => {
        fireEvent.click(within(switcher as HTMLElement).getByRole("button", { name: done }));
      });
      expect([...before, shown("backlog"), shown("done")]).toEqual([true, false, false, true]);
      restore();
    });
  }

  test("at 390 the arrows across columns switch the shown column, and focus follows", async () => {
    const { resize, restore } = setup();
    await ready();
    await resize(390);
    title("A")?.focus();
    await press("ArrowRight");
    await settleMaybe(() => focused() === "D");
    expect([focused(), shown("backlog"), shown("in_progress")]).toEqual(["D", false, true]);
    restore();
  });

  test("a wide board has no switcher and shows every column", async () => {
    const { resize, restore } = setup();
    await ready();
    await resize(992);
    expect([
      screen.queryByRole("group", { name: "Columns" }) === null,
      shown("backlog"),
      shown("done"),
    ]).toEqual([true, true, true]);
    restore();
  });
});
