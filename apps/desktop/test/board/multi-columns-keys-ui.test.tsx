import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cleanup } from "@testing-library/react";
import { memoryPlatform } from "../fixtures.ts";
import { settle, settleMaybe } from "../wait.ts";
import {
  AppStore,
  act,
  BoardView,
  click,
  ctrl,
  fireEvent,
  host,
  lane,
  li,
  ready,
  render,
  screen,
  selected,
  setup,
  within,
} from "./multi-setup.tsx";

setDefaultTimeout(30_000);
afterEach(cleanup);

describe("board-multi-ui: resizable columns (issue #161)", () => {
  const handles = () => screen.getAllByRole("separator", { name: "Resize the columns" });
  const grid = () => document.querySelector("[data-slot='board-columns']") as HTMLElement;

  test("a handle on every column announces the width and its limits; the last one is the tab stop", async () => {
    setup();
    await ready();
    expect(handles()).toHaveLength(5);
    const first = handles()[0] as HTMLElement;
    expect(first.getAttribute("aria-orientation")).toBe("vertical");
    expect(first.getAttribute("aria-valuemin")).toBe("180");
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
    expect(grid().style.gridAutoColumns).toBe("180px");
    expect(w.store.boardWidth.value).toBe(180);
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
    render(
      <BoardView
        store={store}
        hostId="h1"
        projectId="p1"
        onOpenCard={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    expect(grid().style.gridAutoColumns).toBe("340px");
  });
});

describe("board-multi-ui: counts under a filter (issue #161)", () => {
  const count = (name: string) => lane(name).querySelector(".column-count")?.textContent;

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
    expect(
      within(lane("In progress")).queryByRole("button", { name: "Empty, Add card" }),
    ).toBeNull();
    // A column that never had a card is still just empty, with its button.
    expect(count("Needs you")).toBe("0");
    expect(within(lane("Needs you")).getByRole("button", { name: "Empty, Add card" })).toBeTruthy();
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
    await settle(() => w.commands.some(([, type]) => type === "card.create"));
    // One step: the column is part of the create command, nothing is moved afterwards.
    expect(w.commands.filter(([, type]) => type === "card.create" || type === "card.move")).toEqual(
      [
        [
          "h1",
          "card.create",
          { projectId: "p1", title: "Fresh", description: "", column: "review" },
        ],
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
    await settle(() => document.querySelector("[data-slot='board-columns']") !== null);
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Card A"), { ctrlKey: true });
    });
    const bar = screen.getByRole("group", { name: "Seleção" });
    expect(within(bar).getByText("1 selecionado")).toBeTruthy();
    expect(within(bar).getByRole("button", { name: "Descartar…" })).toBeTruthy();
    expect(screen.getAllByRole("separator", { name: "Redimensionar as colunas" })).toHaveLength(5);
  });
});

/**
 * #1354 (docs/decisions/2026-11-09-board-bulk-actions.md): the selection from the keyboard, inside
 * #1198's roving Tab stop, and a check on each card while a selection exists.
 */
describe("board-multi-ui: selecting with the keys and the checks (#1354)", () => {
  const titleOf = (name: string) => li(name).querySelector<HTMLElement>("[data-card-open]");
  const focused = () => document.activeElement?.closest("li")?.getAttribute("aria-label") ?? "";
  const press = (key: string, init: object = {}) =>
    act(async () => {
      fireEvent.keyDown(document.activeElement as Element, { key, ...init });
    });
  // The board's status line (an <output>, polite): it says the bar's count, filter and all.
  const live = () => document.querySelector("[data-slot='board-status']")?.textContent ?? null;

  test("x toggles the focused card, and a polite live region says the count", async () => {
    setup();
    await ready();
    titleOf("A")?.focus();
    await press("x");
    const once = [selected(), live()];
    await press("x");
    expect([...once, selected(), live()]).toEqual([["A"], "1 selected", [], ""]);
  });

  test("Shift+Down moves the focus and selects from the anchor; with no anchor the card left is it", async () => {
    setup();
    await ready();
    titleOf("A")?.focus();
    await press("ArrowDown", { shiftKey: true });
    const first = [selected(), focused()];
    await press("ArrowDown", { shiftKey: true });
    expect([...first, selected(), focused()]).toEqual([
      ["A", "B"],
      "Card B",
      ["A", "B", "C"],
      "Card C",
    ]);
  });

  // From the ux-reviewer: a range from the keys starts where the person is, and goes back as well.
  test("after Esc, Shift+Down ranges from the focused card, not from a card picked before", async () => {
    setup();
    await ready();
    titleOf("A")?.focus();
    await press("x");
    await press("Escape");
    titleOf("B")?.focus();
    await press("ArrowDown", { shiftKey: true });
    expect(selected()).toEqual(["B", "C"]);
  });

  test("Shift+Up after Shift+Down shrinks the range back toward its start", async () => {
    setup();
    await ready();
    titleOf("A")?.focus();
    await press("ArrowDown", { shiftKey: true });
    await press("ArrowDown", { shiftKey: true });
    await press("ArrowUp", { shiftKey: true });
    expect([selected(), focused()]).toEqual([["A", "B"], "Card B"]);
  });

  test("a click on a card's check leaves the focus on the card, where the keys work", async () => {
    setup();
    await ready();
    await ctrl("A");
    const check = within(li("B")).queryByRole("checkbox", { name: "Select B" });
    if (check) await click(check);
    const afterSelect = focused();
    const again = within(li("B")).queryByRole("checkbox", { name: "Select B" });
    if (again) await click(again);
    expect([afterSelect, focused(), selected()]).toEqual(["Card B", "Card B", ["A"]]);
  });

  test("Esc clears the selection, keeps the focus on the card and goes no further; with none it passes on", async () => {
    setup();
    await ready();
    let reached = 0;
    const count = (e: KeyboardEvent) => {
      if (e.key === "Escape") reached++;
    };
    document.addEventListener("keydown", count);
    try {
      titleOf("B")?.focus();
      await press("x");
      await press("Escape");
      const cleared = [selected(), focused(), reached];
      await press("Escape");
      expect([...cleared, reached]).toEqual([[], "Card B", 0, 1]);
    } finally {
      document.removeEventListener("keydown", count);
    }
  });

  // PR B of #1354: with a selection, s asks to start the selection; it never starts the focused
  // card alone, even one outside the selection. m opens the bar's Move to….
  test("with a selection, s asks to start the selection, not the focused card, and m opens the bar's Move to…", async () => {
    const { commands, requests } = setup();
    await ready();
    titleOf("A")?.focus();
    await press("x");
    titleOf("C")?.focus();
    await press("s");
    await settleMaybe(() => screen.queryByRole("alertdialog") !== null);
    const asked = screen.queryByRole("heading", { name: "Start 1 card?" }) !== null;
    const started = [...commands, ...requests].filter(([, type]) => type === "card.start");
    await press("Escape");
    await settleMaybe(() => screen.queryByRole("alertdialog") === null);
    titleOf("C")?.focus();
    await press("m");
    await settleMaybe(() => screen.queryByRole("menuitem", { name: "Done" }) !== null);
    expect([
      asked,
      started.length,
      screen.queryByRole("menuitem", { name: "Done" }) !== null,
      screen.queryByRole("menuitem", { name: "Move to Done" }) !== null,
    ]).toEqual([true, 0, true, false]);
  });

  test("m opens the bar's Move to…, and closing it with Esc brings the focus back to the card", async () => {
    setup();
    await ready();
    titleOf("B")?.focus();
    await press("x");
    await press("m");
    await settleMaybe(() => screen.queryByRole("menuitem", { name: "Done" }) !== null);
    await press("Escape");
    await settleMaybe(() => screen.queryByRole("menuitem", { name: "Done" }) === null);
    // The menu gives the focus back when it has finished closing, a tick or more after it goes.
    await settleMaybe(() => focused() === "Card B");
    expect([focused(), selected()]).toEqual(["Card B", ["B"]]);
  });

  test("while a selection exists every card has a check, not a Tab stop, that toggles it", async () => {
    setup();
    await ready();
    const before = document.querySelectorAll("li[data-card] input[type='checkbox']").length;
    await ctrl("A");
    const checks = [
      ...document.querySelectorAll<HTMLInputElement>("li[data-card] input[type='checkbox']"),
    ];
    const b = within(li("B")).queryByRole("checkbox", { name: "Select B" });
    if (b) await click(b);
    expect([
      before,
      checks.length,
      checks.every((check) => check.tabIndex === -1),
      checks.every((check) => check.closest(".hit-control") !== null),
      selected(),
    ]).toEqual([0, 5, true, true, ["A", "B"]]);
  });

  test("pt-BR: the check is named Selecionar and the live region counts in Portuguese", async () => {
    setup({ language: "pt-BR" });
    await settle(() => screen.queryByLabelText("Card A") !== null);
    titleOf("A")?.focus();
    await press("x");
    expect([
      within(li("A")).queryByRole("checkbox", { name: "Selecionar A" }) !== null,
      live(),
    ]).toEqual([true, "1 selecionado"]);
  });
});
