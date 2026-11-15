import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { settleMaybe } from "../wait.ts";
import {
  act,
  bar,
  button,
  CARDS,
  type Call,
  card,
  cleanup,
  click,
  ctrl,
  fireEvent,
  focusAt,
  ready,
  screen,
  selected,
  setup,
  started,
  within,
} from "./bulk-ui-setup.tsx";

setDefaultTimeout(30_000);
afterEach(cleanup);

// #1406: Update from the base for the selection, after main moved. It takes the idle cards with a
// branch, one after the other, leaves a current card alone, stops only a conflicted card, and the
// summary names each group.
const branched = (id: string, position: number, over: object = {}) =>
  card(id, "review", position, {
    branch: `fd/${id.toLowerCase()}`,
    worktreePath: `/w/${id}`,
    sessionStatus: "idle",
    sessionId: `s-${id}`,
    ...over,
  });
const UPDATABLE = [...CARDS, branched("F", 1), branched("G", 2), branched("H", 3)];
const updated = (requests: Call[]) => started(requests, "card.updateFromBase");
/** The board's notice, without its Dismiss button. */
const noticeText = () =>
  screen
    .queryAllByRole("button", { name: /^Dismiss|^Dispensar/ })
    .map((b) =>
      [...(b.parentElement?.childNodes ?? [])]
        .filter((node) => node !== b)
        .map((node) => node.textContent ?? "")
        .join("")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .join("");

describe("board-bulk-ui: Update from the base for the selection (#1406)", () => {
  test("the bar counts only the idle cards with a branch, and shows the action only when there is one", async () => {
    const { restore } = setup({ cards: UPDATABLE });
    await ready();
    await ctrl("A", "B");
    const none =
      within(bar() as HTMLElement).queryByRole("button", { name: /from the base/ }) === null;
    await ctrl("D", "F", "G");
    expect([
      none,
      within(bar() as HTMLElement).queryByRole("button", { name: "Update 2 from the base" }) !==
        null,
    ]).toEqual([true, true]);
    restore();
  });

  test("it runs card by card with its progress on the bar, then sums up; a conflicted card stays selected", async () => {
    let release = () => {};
    const holdUpdate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { requests, restore } = setup({
      cards: UPDATABLE,
      behind: { F: 2, G: 0, H: 1 },
      conflict: ["H"],
      holdUpdate,
    });
    await ready();
    await ctrl("F", "G", "H");
    const update = button(bar(), "Update 3 from the base");
    update.focus();
    await click(update);
    await settleMaybe(() => (bar()?.textContent ?? "").includes("Updating 0 of 3…"));
    const during = {
      progress: (bar()?.textContent ?? "").includes("Updating 0 of 3…"),
      off: update.hasAttribute("disabled"),
    };
    await act(async () => {
      release();
    });
    await settleMaybe(() => noticeText().includes("Updated:"));
    expect({
      during,
      // G is on its base already: it is not rebased.
      asked: updated(requests),
      notice: noticeText(),
      selected: selected(),
      focus: focusAt().text,
    }).toEqual({
      during: { progress: true, off: true },
      asked: ["F", "H"],
      notice:
        "Updated: F. Already current: G. Conflict, left as it was: H (Updating with main conflicts in: src/a.ts).",
      selected: ["H"],
      focus: "Update 1 from the base",
    });
    restore();
  });

  test("a card the host refuses is named as not updated, with why", async () => {
    const { restore } = setup({ cards: UPDATABLE, refuse: ["G"] });
    await ready();
    await ctrl("F", "G");
    await click(button(bar(), "Update 2 from the base"));
    await settleMaybe(() => noticeText().includes("Not updated"));
    expect([noticeText(), selected()]).toEqual([
      "Updated: F. Not updated: G (the host refused).",
      ["G"],
    ]);
    restore();
  });

  test("a request that throws does not leave the bar stuck: the cards are named as not updated", async () => {
    const { restore } = setup({ cards: UPDATABLE, throwChanges: true });
    await ready();
    await ctrl("F", "G");
    await click(button(bar(), "Update 2 from the base"));
    await settleMaybe(() => !button(bar(), "Update 2 from the base").hasAttribute("disabled"));
    expect([
      button(bar(), "Update 2 from the base").hasAttribute("disabled"),
      (bar()?.textContent ?? "").includes("Updating"),
      noticeText(),
    ]).toEqual([false, false, "Not updated: F (link dropped), G (link dropped)."]);
    restore();
  });

  test("at 390 the action is under ⋯ with Move to and Discard", async () => {
    const { requests, resize, restore } = setup({ cards: UPDATABLE });
    await ready();
    await resize(358);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^In review/ }));
    });
    await ctrl("F", "G");
    const more = button(bar(), "More actions for the selection");
    await act(async () => {
      fireEvent.pointerDown(more, { button: 0, ctrlKey: false, pointerType: "mouse" });
    });
    const item = screen.queryByRole("menuitem", { name: "Update 2 from the base" });
    expect(item).not.toBeNull();
    await click(item as HTMLElement);
    await settleMaybe(() => noticeText().includes("Updated:"));
    // Both went: the selection is empty, so the bar is gone.
    expect([bar() === null, updated(requests), noticeText()]).toEqual([
      true,
      ["F", "G"],
      "Updated: F, G.",
    ]);
    restore();
  });

  test("pt-BR: Atualizar com a base, and the summary in Portuguese", async () => {
    const { restore } = setup({ language: "pt-BR", cards: UPDATABLE, behind: { G: 0 } });
    await ready();
    await ctrl("F", "G");
    await click(button(bar("Seleção"), "Atualizar 2 com a base"));
    await settleMaybe(() => noticeText().includes("Atualizados"));
    expect(noticeText()).toBe("Atualizados: F. Já em dia: G.");
    restore();
  });
});
