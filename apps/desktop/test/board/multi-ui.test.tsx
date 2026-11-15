import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cleanup } from "@testing-library/react";
import { settle } from "../wait.ts";
import {
  act,
  bar,
  barButton,
  CARDS,
  click,
  ctrl,
  fireEvent,
  lane,
  li,
  present,
  ready,
  screen,
  selected,
  setup,
  within,
} from "./multi-setup.tsx";

setDefaultTimeout(30_000);
afterEach(cleanup);

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

  // #1354: the check carries the state, so a screen reader hears it once (the sr-only "selected" is gone).
  test("a selected card says so to a screen reader, and the card menu can select it too", async () => {
    setup();
    await ready();
    await ctrl("A");
    const check = within(li("A")).queryByRole("checkbox", {
      name: "Select A",
    }) as HTMLInputElement | null;
    expect([check?.checked, within(li("A")).queryByText("selected") === null]).toEqual([
      true,
      true,
    ]);
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
    expect(within(present(bar())).getByText("1 selected")).toBeTruthy();
    await ctrl("B");
    await ctrl("C");
    expect(within(present(bar())).getByText("3 selected")).toBeTruthy();
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
    expect(within(present(bar())).getByText("1 selected")).toBeTruthy();
    expect(within(present(bar())).getByText("1 hidden by the filter")).toBeTruthy();
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
    expect(within(present(bar())).getByText("1 selected")).toBeTruthy();
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
    expect(items.map((i) => i.textContent)).toEqual([
      "A",
      "B — its worktree and branch go with it; uncommitted changes and unpushed commits are lost",
    ]);
    expect(items[0]?.textContent).not.toContain("worktree");
  });

  test("cancelling leaves every card and the selection untouched", async () => {
    const w = await discarding();
    await click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );
    expect(w.commands.filter(([, type]) => /discard|delete/.test(type))).toEqual([]);
    expect(w.requests).toEqual([]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
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
