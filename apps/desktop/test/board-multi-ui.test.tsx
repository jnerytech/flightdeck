import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { BoardView } = await import("../src/ui/BoardView.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

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

const card = (id: string, column: string, position: number, over: object = {}) => ({
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
  ...over,
});

const CARDS = [
  card("A", "backlog", 1),
  card("B", "backlog", 2, { branch: "fd/b", worktreePath: "/wt/b" }),
  card("C", "backlog", 3),
  card("D", "in_progress", 1),
  card("E", "done", 1),
];

type Call = [string, string, unknown];

function setup(options: { cards?: object[]; language?: "en" | "pt-BR"; refuse?: string[] } = {}) {
  const mem = memoryPlatform(false, options.language ?? "en");
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const internals = store as unknown as { update(p: object): void };
  const put = (list: object[]) =>
    internals.update({
      cards: Object.fromEntries(list.map((c) => [`h1/${(c as { id: string }).id}`, c])),
    });
  internals.update({ hosts: [host] });
  put(options.cards ?? CARDS);
  const commands: Call[] = [];
  const requests: Call[] = [];
  store.hostCommand = (async (hostId: string, type: string, payload: unknown) => {
    commands.push([hostId, type, payload]);
    if (type === "board.get") return { project: { id: "p1", name: "api" }, cards: [] };
    if (type === "card.create") return { id: "new1", ...(payload as object) };
    return {};
  }) as never;
  store.hostRequest = (async (hostId: string, type: string, payload: unknown) => {
    requests.push([hostId, type, payload]);
    const id = (payload as { cardId?: string }).cardId ?? "";
    return options.refuse?.includes(id)
      ? { ok: false, message: "the host refused" }
      : { ok: true, data: {} };
  }) as never;
  const opened: string[] = [];
  render(
    <BoardView
      store={store}
      hostId="h1"
      projectId="p1"
      onOpenCard={(id) => void opened.push(id)}
    />,
  );
  return { store, mem, commands, requests, opened, put };
}

const li = (title: string) => screen.getByLabelText(`Card ${title}`);
const lane = (name: string) => screen.getByRole("region", { name });
const selected = () =>
  [...document.querySelectorAll("li[data-selected='true']")].map((el) =>
    (el.getAttribute("aria-label") ?? "").replace(/^Card /, ""),
  );
const click = (el: Element, init: object = {}) =>
  act(async () => {
    fireEvent.click(el, init);
  });
const ctrl = (title: string) => click(li(title), { ctrlKey: true });
const bar = () => screen.queryByRole("group", { name: "Selection" });
const barButton = (name: string) =>
  within(bar() as HTMLElement).getByRole("button", { name }) as HTMLElement;
const ready = () => settle(() => screen.queryByRole("heading", { name: "Board of api" }) !== null);

describe("board-multi-ui: selecting cards (issue #161)", () => {
  test("Ctrl-click selects, Ctrl-click again unselects, and a plain click still opens the card", async () => {
    const w = setup();
    await ready();
    await ctrl("A");
    expect(selected()).toEqual(["A"]);
    await ctrl("C");
    expect(selected()).toEqual(["A", "C"]);
    await ctrl("A");
    expect(selected()).toEqual(["C"]);
    await click(within(li("D")).getByRole("button", { name: "D" }));
    expect(w.opened).toEqual(["D"]);
    expect(selected()).toEqual(["C"]);
  });

  test("Cmd-click does the same on a Mac", async () => {
    setup();
    await ready();
    await click(li("A"), { metaKey: true });
    expect(selected()).toEqual(["A"]);
  });

  test("Shift-click selects the range from the last selected card within the column", async () => {
    setup();
    await ready();
    await ctrl("A");
    await click(li("C"), { shiftKey: true });
    expect(selected()).toEqual(["A", "B", "C"]);
  });

  test("a selected card says so to a screen reader, and the card menu can select it too", async () => {
    setup();
    await ready();
    await ctrl("A");
    expect(within(li("A")).getByText("selected")).toBeTruthy();
    await act(async () => {
      fireEvent.pointerDown(within(li("B")).getByRole("button", { name: "Actions for B" }), {
        button: 0,
        ctrlKey: false,
        pointerType: "mouse",
      });
    });
    await click(await screen.findByRole("menuitem", { name: "Select card" }));
    expect(selected()).toEqual(["A", "B"]);
    await act(async () => {
      fireEvent.pointerDown(within(li("B")).getByRole("button", { name: "Actions for B" }), {
        button: 0,
        ctrlKey: false,
        pointerType: "mouse",
      });
    });
    await click(await screen.findByRole("menuitem", { name: "Deselect card" }));
    expect(selected()).toEqual(["A"]);
  });

  test("Esc clears the selection", async () => {
    setup();
    await ready();
    await ctrl("A");
    await act(async () => {
      fireEvent.keyDown(li("A"), { key: "Escape" });
    });
    expect(selected()).toEqual([]);
    expect(bar()).toBeNull();
  });

  test("a bar above the board counts them, and Clear empties it", async () => {
    setup();
    await ready();
    expect(bar()).toBeNull();
    await ctrl("A");
    expect(within(bar() as HTMLElement).getByText("1 selected")).toBeTruthy();
    await ctrl("B");
    await ctrl("C");
    expect(within(bar() as HTMLElement).getByText("3 selected")).toBeTruthy();
    for (const name of ["Move to…", "Discard…", "Clear selection"]) {
      expect(barButton(name)).toBeTruthy();
    }
    await click(barButton("Clear selection"));
    expect(selected()).toEqual([]);
  });

  test("a filter hides cards but keeps them selected; the bar says so and acts on the shown ones", async () => {
    const w = setup();
    await ready();
    await ctrl("A");
    await ctrl("B");
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Filter cards"), { target: { value: "about B" } });
    });
    expect(within(bar() as HTMLElement).getByText("1 selected")).toBeTruthy();
    expect(within(bar() as HTMLElement).getByText("1 hidden by the filter")).toBeTruthy();
    await act(async () => {
      fireEvent.pointerDown(barButton("Move to…"), {
        button: 0,
        ctrlKey: false,
        pointerType: "mouse",
      });
    });
    await click(await screen.findByRole("menuitem", { name: "Done" }));
    await settle(() => w.requests.length === 1);
    expect(w.requests).toEqual([["h1", "card.move", { cardId: "B", column: "done" }]]);
  });

  test("a card that goes away leaves the selection", async () => {
    const w = setup();
    await ready();
    await ctrl("A");
    await ctrl("B");
    act(() => w.put(CARDS.filter((c) => (c as { id: string }).id !== "A")));
    expect(within(bar() as HTMLElement).getByText("1 selected")).toBeTruthy();
    expect(selected()).toEqual(["B"]);
  });
});

describe("board-multi-ui: moving many cards (issue #161)", () => {
  test("the bar's Move to… sends each card to the column, in the board's order", async () => {
    const w = setup();
    await ready();
    await ctrl("C");
    await ctrl("A");
    await act(async () => {
      fireEvent.pointerDown(barButton("Move to…"), {
        button: 0,
        ctrlKey: false,
        pointerType: "mouse",
      });
    });
    await click(await screen.findByRole("menuitem", { name: "Done" }));
    await settle(() => w.requests.length === 2);
    expect(w.requests.map((r) => (r[2] as { cardId: string }).cardId)).toEqual(["A", "C"]);
    expect(w.requests.every((r) => (r[2] as { column: string }).column === "done")).toBe(true);
    // The selection is spent once they have moved.
    await settle(() => selected().length === 0);
  });

  test("a card the host refuses stays selected and is named in a notice", async () => {
    const w = setup({ refuse: ["B"] });
    await ready();
    await ctrl("A");
    await ctrl("B");
    await act(async () => {
      fireEvent.pointerDown(barButton("Move to…"), {
        button: 0,
        ctrlKey: false,
        pointerType: "mouse",
      });
    });
    await click(await screen.findByRole("menuitem", { name: "Done" }));
    await settle(() => w.requests.length === 2);
    const notice = await screen.findByRole("status");
    expect(notice.textContent).toContain("1 card stayed where it was");
    expect(notice.textContent).toContain("B (the host refused)");
    await settle(() => selected().join() === "B");
  });

  test("dragging a selected card drags the whole selection into the column they land in", async () => {
    const w = setup();
    await ready();
    await ctrl("A");
    await ctrl("C");
    await act(async () => {
      fireEvent.dragStart(li("C"));
    });
    await act(async () => {
      fireEvent.drop(lane("Done"));
    });
    await settle(() => w.requests.length === 2);
    expect(w.requests.map((r) => (r[2] as { cardId: string }).cardId)).toEqual(["A", "C"]);
    expect(w.commands.filter(([, type]) => type === "card.move")).toEqual([]);
  });

  test("dragging a card that is not selected moves only that card, as before", async () => {
    const w = setup();
    await ready();
    await ctrl("A");
    await act(async () => {
      fireEvent.dragStart(li("D"));
    });
    await act(async () => {
      fireEvent.drop(lane("Done"));
    });
    expect(w.commands.filter(([, type]) => type === "card.move")).toEqual([
      ["h1", "card.move", { cardId: "D", column: "done" }],
    ]);
    expect(w.requests).toEqual([]);
  });
});

describe("board-multi-ui: discarding many cards (issue #161)", () => {
  async function discarding() {
    const w = setup();
    await ready();
    await ctrl("A");
    await ctrl("B");
    await click(barButton("Discard…"));
    return w;
  }

  test("one dialog lists every card, and says which ones have work to clean up", async () => {
    await discarding();
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Discard 2 cards?")).toBeTruthy();
    const items = within(dialog).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual(["A", expect.stringContaining("B")]);
    expect(items[1]?.textContent).toContain("its worktree and branch go with it");
    expect(items[0]?.textContent).not.toContain("worktree");
  });

  test("cancelling leaves every card and the selection untouched", async () => {
    const w = await discarding();
    await click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );
    expect(w.commands.filter(([, type]) => /discard|delete/.test(type))).toEqual([]);
    expect(selected()).toEqual(["A", "B"]);
  });

  test("confirming discards the started cards and deletes the others, then clears the selection", async () => {
    const w = await discarding();
    await click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Discard 2 cards",
      }),
    );
    await settle(() => w.requests.length === 2);
    expect(w.requests).toEqual([
      ["h1", "card.delete", { cardId: "A", confirm: true }],
      ["h1", "card.discard", { cardId: "B", confirm: true }],
    ]);
    await settle(() => selected().length === 0);
  });
});

describe("board-multi-ui: resizable columns (issue #161)", () => {
  const handles = () => screen.getAllByRole("separator", { name: "Resize the columns" });
  const grid = () => document.querySelector("[data-slot='board-grid']") as HTMLElement;

  test("a handle on every column announces the width and its limits; the last one is the tab stop", async () => {
    setup();
    await ready();
    expect(handles()).toHaveLength(5);
    const first = handles()[0] as HTMLElement;
    expect(first.getAttribute("aria-orientation")).toBe("vertical");
    expect(first.getAttribute("aria-valuemin")).toBe("220");
    expect(first.getAttribute("aria-valuemax")).toBe("520");
    expect(first.getAttribute("aria-valuenow")).toBe("260");
    expect(first.getAttribute("aria-valuetext")).toBe("260 px");
    expect(first.tabIndex).toBe(-1);
    expect((handles()[4] as HTMLElement).tabIndex).toBe(0);
    expect(grid().style.gridAutoColumns).toBe("260px");
  });

  test("the arrows change the width by 20 px, within the limits, for every column at once", async () => {
    const w = setup();
    await ready();
    const first = handles()[4] as HTMLElement;
    await act(async () => {
      fireEvent.keyDown(first, { key: "ArrowRight" });
    });
    expect(grid().style.gridAutoColumns).toBe("280px");
    expect(handles()[3]?.getAttribute("aria-valuenow")).toBe("280");
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        fireEvent.keyDown(first, { key: "ArrowLeft" });
      });
    }
    expect(grid().style.gridAutoColumns).toBe("220px");
    expect(w.store.boardWidth.value).toBe(220);
  });

  test("dragging the handle changes the width by the distance, and the width is kept", async () => {
    const w = setup();
    await ready();
    const first = handles()[0] as HTMLElement;
    await act(async () => {
      first.dispatchEvent(new window.MouseEvent("pointerdown", { clientX: 100, bubbles: true }));
    });
    await act(async () => {
      window.dispatchEvent(new window.MouseEvent("pointermove", { clientX: 140 }));
    });
    expect(grid().style.gridAutoColumns).toBe("300px");
    await act(async () => {
      window.dispatchEvent(new window.MouseEvent("pointerup", { clientX: 140 }));
    });
    await act(async () => {
      window.dispatchEvent(new window.MouseEvent("pointermove", { clientX: 400 }));
    });
    expect(grid().style.gridAutoColumns).toBe("300px");
    expect(w.mem.platform.storage.getItem("flightdeck.boardColumnWidth")).toBe("300");
  });

  test("the width comes back after a restart", async () => {
    const mem = memoryPlatform(false, "en");
    mem.platform.storage.setItem("flightdeck.boardColumnWidth", "340");
    const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    store.hostCommand = (async () => ({ project: { id: "p1", name: "api" } })) as never;
    (store as unknown as { update(p: object): void }).update({ hosts: [host] });
    render(<BoardView store={store} hostId="h1" projectId="p1" onOpenCard={() => {}} />);
    expect(grid().style.gridAutoColumns).toBe("340px");
  });
});

describe("board-multi-ui: counts under a filter (issue #161)", () => {
  const count = (name: string) =>
    lane(name).querySelector("[data-slot='column-count']")?.textContent;

  test("each column shows how many cards it has", async () => {
    setup();
    await ready();
    expect([count("Backlog"), count("In progress"), count("Needs you"), count("Done")]).toEqual([
      "3",
      "1",
      "0",
      "1",
    ]);
  });

  test("with a filter on, a column reads n / total and an emptied one says No matches", async () => {
    setup();
    await ready();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Filter cards"), { target: { value: "about B" } });
    });
    expect(count("Backlog")).toBe("1 / 3");
    expect(count("In progress")).toBe("0 / 1");
    expect(within(lane("In progress")).getByText("No matches")).toBeTruthy();
    expect(within(lane("In progress")).queryByRole("button", { name: "Add card" })).toBeNull();
    // A column that never had a card is still just empty, with its button.
    expect(count("Needs you")).toBe("0");
    expect(within(lane("Needs you")).getByRole("button", { name: "Add card" })).toBeTruthy();
  });
});

describe("board-multi-ui: a new card at the bottom of a column (issue #161)", () => {
  test("every column has a button that creates the card in that column", async () => {
    const w = setup();
    await ready();
    const quick = within(lane("In review")).getByRole("button", { name: "New card in In review" });
    await click(quick);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Card title"), { target: { value: "Fresh" } });
    });
    await click(screen.getByRole("button", { name: "Create card" }));
    await settle(() => w.commands.some(([, type]) => type === "card.move"));
    expect(w.commands.filter(([, type]) => type === "card.create" || type === "card.move")).toEqual(
      [
        ["h1", "card.create", { projectId: "p1", title: "Fresh", description: "" }],
        ["h1", "card.move", { cardId: "new1", column: "review" }],
      ],
    );
  });

  test("a card made in Backlog is not moved", async () => {
    const w = setup();
    await ready();
    await click(within(lane("Backlog")).getByRole("button", { name: "New card in Backlog" }));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Card title"), { target: { value: "Plain" } });
    });
    await click(screen.getByRole("button", { name: "Create card" }));
    await settle(() => w.commands.some(([, type]) => type === "card.create"));
    expect(w.commands.some(([, type]) => type === "card.move")).toBe(false);
  });

  test("the button is there for touch and keyboard: it shows on focus and where there is no hover", async () => {
    setup();
    await ready();
    const quick = within(lane("Done")).getByRole("button", { name: "New card in Done" });
    expect(quick.className).toContain("focus-visible:opacity-100");
    expect(quick.className).toContain("hover:hover");
  });
});

describe("board-multi-ui: it reads in Portuguese too", () => {
  test("the bar, the counts and the handle have their words", async () => {
    setup({ language: "pt-BR" });
    await settle(() => document.querySelector("[data-slot='board-grid']") !== null);
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Card A"), { ctrlKey: true });
    });
    const bar = screen.getByRole("group", { name: "Seleção" });
    expect(within(bar).getByText("1 selecionado")).toBeTruthy();
    expect(within(bar).getByRole("button", { name: "Descartar…" })).toBeTruthy();
    expect(screen.getAllByRole("separator", { name: "Redimensionar as colunas" })).toHaveLength(5);
  });
});
