import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { settle } from "../wait.ts";
import {
  act,
  bar,
  barButton,
  CARDS,
  cleanup,
  click,
  ctrl,
  fireEvent,
  grid,
  lane,
  li,
  ready,
  screen,
  selected,
  setup,
  within,
} from "./multi-review-setup.tsx";

setDefaultTimeout(30_000);
afterEach(cleanup);

const handles = () => screen.getAllByRole("separator", { name: "Resize the columns" });
const widthOf = () => grid().style.gridAutoColumns;
const pointer = (type: string, clientX: number, target: EventTarget = window) =>
  act(async () => {
    target.dispatchEvent(new window.MouseEvent(type, { clientX, bubbles: true }));
  });

describe("board-multi-review: dropping a selection on a card (OpenCode review of #161)", () => {
  test("the group lands before the card it was dropped on, in the board's order", async () => {
    const w = setup();
    await ready();
    await ctrl("A");
    await ctrl("C");
    await act(async () => {
      fireEvent.dragStart(li("C"));
    });
    await act(async () => {
      fireEvent.drop(li("E"));
    });
    await settle(() => w.requests.length === 2);
    const [first, second] = w.requests.map(
      (r) => r[2] as { cardId: string; column: string; position: number },
    );
    expect([first?.cardId, first?.column, second?.cardId, second?.column]).toEqual([
      "A",
      "done",
      "C",
      "done",
    ]);
    // E is at position 1: both land before it, A before C.
    expect((first?.position ?? 9) < (second?.position ?? -9)).toBe(true);
    expect((second?.position ?? 9) < 1).toBe(true);
  });
});

describe("board-multi-review: the width handles (OpenCode review of #161)", () => {
  test("a handle follows the pointer: on the third column the distance is shared by the three", async () => {
    setup();
    await ready();
    await pointer("pointerdown", 100, handles()[2] as HTMLElement);
    await pointer("pointermove", 130);
    expect(widthOf()).toBe("270px");
    await pointer("pointerup", 130);
  });

  test("a cancelled touch stops the drag", async () => {
    setup();
    await ready();
    await pointer("pointerdown", 100, handles()[0] as HTMLElement);
    await pointer("pointermove", 120);
    await pointer("pointercancel", 120);
    await pointer("pointermove", 300);
    expect(widthOf()).toBe("280px");
  });

  test("a fractional pointer gives a whole width, and the width is written once, when the drag ends", async () => {
    const w = setup();
    await ready();
    const writes: string[] = [];
    const storage = w.mem.platform.storage;
    const setItem = storage.setItem.bind(storage);
    storage.setItem = (key: string, value: string) => {
      if (key === "flightdeck.boardColumnWidth") writes.push(value);
      setItem(key, value);
    };
    await pointer("pointerdown", 100, handles()[0] as HTMLElement);
    await pointer("pointermove", 120.5);
    await pointer("pointermove", 130.4);
    expect(writes).toEqual([]);
    expect(handles()[0]?.getAttribute("aria-valuenow")).toBe("290");
    await pointer("pointerup", 130.4);
    expect(writes).toEqual(["290"]);
  });

  test("one tab stop for the handles, the last; Home and End reach the limits", async () => {
    setup();
    await ready();
    expect(handles().map((h) => h.tabIndex)).toEqual([-1, -1, -1, -1, 0]);
    const last = handles()[4] as HTMLElement;
    await act(async () => {
      fireEvent.keyDown(last, { key: "End" });
    });
    expect(widthOf()).toBe("520px");
    await act(async () => {
      fireEvent.keyDown(last, { key: "Home" });
    });
    expect(widthOf()).toBe("180px");
  });
});

describe("board-multi-review: the empty column's Add card makes the card there", () => {
  test("in an empty Done the card is created in Done, in one step", async () => {
    const w = setup({ cards: CARDS.filter((c) => c.column !== "done") });
    await ready();
    await click(within(lane("Done")).getByRole("button", { name: "Empty, Add card" }));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Card title"), { target: { value: "Fresh" } });
    });
    await click(screen.getByRole("button", { name: "Create card" }));
    await settle(() => w.commands.some(([, type]) => type === "card.create"));
    expect(w.commands.filter(([, type]) => type === "card.create" || type === "card.move")).toEqual(
      [["h1", "card.create", { projectId: "p1", title: "Fresh", description: "", column: "done" }]],
    );
  });
});

describe("board-multi-review: what a screen reader and a mouse get from the bar", () => {
  test("the bar's place is kept, so the first click does not push the cards down", async () => {
    setup();
    await ready();
    expect(document.querySelector("[data-slot='selection-slot']")).not.toBeNull();
    await ctrl("A");
    expect(document.querySelector("[data-slot='selection-slot']")?.contains(bar())).toBe(true);
  });

  // #760: the slot was a 48 px row of the board's body, kept blank while nothing was selected
  // (an 80 px band above the columns). It is now the toolbar's own row: the bar covers it.
  test("the bar takes the toolbar's row in the page header, and the toolbar comes back once the selection is cleared", async () => {
    setup({ language: "pt-BR" });
    await settle(() => screen.queryByRole("heading", { name: "Board de api" }) !== null);
    const slot = () => document.querySelector("[data-slot='selection-slot']");
    const toolbar = () => screen.queryByRole("toolbar", { name: "Filtros" });
    const look = () => ({
      inHeader: slot()?.closest("[data-slot='page-header']") != null,
      inBody: slot()?.closest("[data-slot='page-body']") != null,
      holdsToolbar: slot()?.contains(toolbar()) ?? false,
      toolbarInert: toolbar()?.closest("[inert]") != null,
      bar: screen.queryByRole("group", { name: "Seleção" }) !== null,
    });
    const idle = look();
    await ctrl("A");
    const picked = look();
    await click(
      within(screen.getByRole("group", { name: "Seleção" })).getByRole("button", {
        name: "Limpar seleção",
      }),
    );
    const cleared = look();
    const resting = {
      inHeader: true,
      inBody: false,
      holdsToolbar: true,
      toolbarInert: false,
      bar: false,
    };
    expect({ idle, picked, cleared }).toEqual({
      idle: resting,
      picked: { ...resting, toolbarInert: true, bar: true },
      cleared: resting,
    });
  });

  test("one live region says how many are selected and what a refusal left", async () => {
    setup({ refuse: { A: { message: "no" } } });
    await ready();
    const status = () => document.querySelector("[data-slot='board-status']") as HTMLElement | null;
    // An <output> is a live region (role status) with no attribute.
    expect(status()?.tagName).toBe("OUTPUT");
    expect(status()?.textContent).toBe("");
    await ctrl("A");
    expect(status()?.textContent).toContain("1 selected");
    await click(barButton("Discard…"));
    await click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Discard 1 card",
      }),
    );
    await settle(() => (status()?.textContent ?? "").includes("could not be discarded"));
  });

  test("the count of a column is read as words, not as a slash", async () => {
    setup();
    await ready();
    const count = (name: string) => lane(name).querySelector(".column-count");
    expect(count("Backlog")?.getAttribute("aria-label")).toBe("3 cards");
    expect(count("Done")?.getAttribute("aria-label")).toBe("1 card");
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Filter cards"), { target: { value: "about B" } });
    });
    expect(count("Backlog")?.getAttribute("aria-label")).toBe("1 of 3 cards");
  });
});

describe("board-multi-review: selecting by range and refusing two moves", () => {
  test("taking a card out does not make it the anchor of the next Shift-click", async () => {
    setup();
    await ready();
    await ctrl("A");
    await ctrl("A");
    await click(li("C"), { shiftKey: true });
    expect(selected()).toEqual(["C"]);
  });

  test("two refusals when moving: the plural, both still selected", async () => {
    const w = setup({ refuse: { A: { message: "busy" }, C: { message: "running" } } });
    await ready();
    await ctrl("A");
    await ctrl("C");
    await act(async () => {
      fireEvent.pointerDown(barButton("Move to…"), {
        button: 0,
        ctrlKey: false,
        pointerType: "mouse",
      });
    });
    await click(await screen.findByRole("menuitem", { name: "Done" }));
    await settle(() => w.requests.length === 2);
    const status = document.querySelector("[data-slot='board-status']") as HTMLElement;
    await settle(() => (status.textContent ?? "").includes("2 cards stayed where they were"));
    expect(status.textContent).toContain("A (busy), C (running)");
    expect(selected()).toEqual(["A", "C"]);
  });
});

describe("board-multi-review: small gaps the coverage gate found", () => {
  test("a key the handle does not use is left alone", async () => {
    setup();
    await ready();
    const last = handles()[4] as HTMLElement;
    const before = widthOf();
    const prevented = !fireEvent.keyDown(last, { key: "a" });
    expect(prevented).toBe(false);
    expect(widthOf()).toBe(before);
  });

  test("the notice goes away when it is dismissed", async () /* NOSONAR: settle() is the assertion: it throws, naming what never showed */ => {
    const w = setup({ refuse: { A: { message: "no" } } });
    await ready();
    await ctrl("A");
    await act(async () => {
      fireEvent.pointerDown(barButton("Move to…"), {
        button: 0,
        ctrlKey: false,
        pointerType: "mouse",
      });
    });
    await click(await screen.findByRole("menuitem", { name: "Done" }));
    await settle(() => w.requests.length === 1);
    await click(await screen.findByRole("button", { name: "Dismiss" }));
    await settle(() => !(document.body.textContent ?? "").includes("stayed where it was"));
  });
});
